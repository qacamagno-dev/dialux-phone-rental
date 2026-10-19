#!/usr/bin/env bash
# ============================================================
# DiaLux — API smoke test
#
# Walks a real customer journey against a running server: register, browse,
# add to cart, wishlist, book, pay, read the invoice, open a support ticket,
# and confirm the admin endpoints correctly refuse a normal account.
#
#   bash phone-rental-backend/scripts/smoke.sh http://localhost:5000
#
# Needs curl and jq. Exits non-zero on the first failure.
# ============================================================

set -euo pipefail

BASE="${1:-http://localhost:5000}"
API="$BASE/api"

# A unique account per run, so repeated runs never collide on the email index.
STAMP="$(date +%s)-$RANDOM"
EMAIL="smoke-$STAMP@dialux.test"
PASSWORD="smoke-password-$STAMP"

pass=0
fail=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass + 1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail + 1)); }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
die()  { printf '\n\033[31mFATAL:\033[0m %s\n' "$1"; exit 1; }

command -v jq >/dev/null || die "jq is required"

# GET/POST helpers. `req METHOD PATH [BODY]` prints the body; `code` prints
# the status only, so negative tests can assert on it.
req() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" "$API$path" \
      -H 'Content-Type: application/json' \
      ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
      -d "$body"
  else
    curl -fsS -X "$method" "$API$path" \
      ${TOKEN:+-H "Authorization: Bearer $TOKEN"}
  fi
}

code() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -o /dev/null -w '%{http_code}' -X "$method" "$API$path" \
      -H 'Content-Type: application/json' \
      ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
      -d "$body"
  else
    curl -s -o /dev/null -w '%{http_code}' -X "$method" "$API$path" \
      ${TOKEN:+-H "Authorization: Bearer $TOKEN"}
  fi
}

TOKEN=""

printf '\033[1mDiaLux smoke test\033[0m → %s\n' "$BASE"

# ----------------------------------------------------------
step '1. Health and public reads'

HEALTH="$(req GET /health)"
[ "$(jq -r .ok <<<"$HEALTH")" = "true" ] && ok "health ok" || bad "health not ok"
[ "$(jq -r .db <<<"$HEALTH")" = "connected" ] && ok "database connected" || die "database is $(jq -r .db <<<"$HEALTH")"

SETTINGS="$(req GET /settings)"
DELIVERY="$(jq -r .deliveryFee <<<"$SETTINGS")"
[ -n "$DELIVERY" ] && ok "settings readable (delivery fee $DELIVERY)" || bad "settings unreadable"

PRODUCTS="$(req GET /products)"
COUNT="$(jq -r '.count // 0' <<<"$PRODUCTS")"
[ "$COUNT" -gt 0 ] && ok "catalog has $COUNT devices" || die "catalog is empty — run npm run seed"

PID="$(jq -r '[.products[] | select(.stock > 0)][0].id' <<<"$PRODUCTS")"
PNAME="$(jq -r --arg id "$PID" '.products[] | select(.id==$id) | .name' <<<"$PRODUCTS")"
[ "$PID" != "null" ] && ok "picked an in-stock device: $PNAME" || die "nothing in stock to book"

[ "$(jq -r '.pages | length' <<<"$(req GET /pages)")" = "6" ] && ok "six CMS pages served" || bad "CMS page list wrong"

# ----------------------------------------------------------
step '2. Account'

AUTH="$(req POST /auth/register "$(jq -nc --arg n 'Smoke Test' --arg e "$EMAIL" --arg p "$PASSWORD" \
  '{name:$n,email:$e,password:$p}')")"
TOKEN="$(jq -r .token <<<"$AUTH")"
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && ok "registered $EMAIL" || die "registration failed"

ME="$(req GET /auth/me)"
[ "$(jq -r .email <<<"$ME")" = "$EMAIL" ] && ok "session restores" || bad "/auth/me mismatch"
[ "$(jq -r .password <<<"$ME")" = "null" ] && ok "password hash never leaves the server" || bad "PASSWORD HASH LEAKED"
[ "$(jq -r .hasPassword <<<"$ME")" = "true" ] && ok "hasPassword flag present" || bad "hasPassword missing"

# The welcome notification is written during registration.
[ "$(jq -r .unread <<<"$(req GET /notifications)")" -ge 1 ] && ok "welcome notification raised" || bad "no welcome notification"

# ----------------------------------------------------------
step '3. Wishlist'

WISH="$(req POST "/wishlist/$PID")"
[ "$(jq -r .count <<<"$WISH")" = "1" ] && ok "device saved to wishlist" || bad "wishlist add failed"
[ "$(jq -r '.ids[0]' <<<"$WISH")" = "$PID" ] && ok "wishlist returns ids" || bad "wishlist ids wrong"
# Idempotent — a double tap must not duplicate.
[ "$(jq -r .count <<<"$(req POST "/wishlist/$PID")")" = "1" ] && ok "wishlist add is idempotent" || bad "wishlist duplicated"
[ "$(jq -r .count <<<"$(req DELETE "/wishlist/$PID")")" = "0" ] && ok "wishlist remove works" || bad "wishlist remove failed"

# ----------------------------------------------------------
step '4. Address and cart'

req PATCH /users/me/profile '{"phone":"09170000000","address":"1 Smoke Street","city":"Quezon City","zip":"1100"}' >/dev/null
ADDRS="$(req GET /users/me/addresses)"
[ "$(jq -r '.addresses | length' <<<"$ADDRS")" = "1" ] && ok "legacy profile save creates an address" || bad "address not created"
[ "$(jq -r '.addresses[0].isDefault' <<<"$ADDRS")" = "true" ] && ok "first address is the default" || bad "default flag missing"

CART="$(req POST /cart/items "$(jq -nc --arg id "$PID" '{productId:$id,plan:"Weekly",qty:1}')")"
[ "$(jq -r .count <<<"$CART")" = "1" ] && ok "added to cart" || bad "cart add failed"

START="$(date -u -d '+1 day' +%F 2>/dev/null || date -u -v+1d +%F)"
END="$(date -u -d '+8 days' +%F 2>/dev/null || date -u -v+8d +%F)"
CART="$(req PATCH /cart "$(jq -nc --arg s "$START" --arg e "$END" '{startDate:$s,endDate:$e}')")"
[ "$(jq -r .days <<<"$CART")" = "7" ] && ok "rental window prices 7 days" || bad "day count wrong: $(jq -r .days <<<"$CART")"

CART="$(req PATCH /cart '{"protection":true}')"
PFEE="$(jq -r .protectionFee <<<"$CART")"
[ "$PFEE" -gt 0 ] && ok "damage protection priced ($PFEE)" || bad "protection fee not applied"

RENT="$(jq -r .rent <<<"$CART")"
DEP="$(jq -r .deposit <<<"$CART")"
DEL="$(jq -r .delivery <<<"$CART")"
TOTAL="$(jq -r .total <<<"$CART")"
[ "$TOTAL" -eq $((RENT + DEP + DEL + PFEE)) ] && ok "cart total adds up" || bad "cart total mismatch"

# ----------------------------------------------------------
step '5. Booking, payment, invoice'

ORDER="$(req POST /orders "$(jq -nc --arg s "$START" --arg e "$END" '{startDate:$s,endDate:$e,protection:true}')")"
OID="$(jq -r .id <<<"$ORDER")"
[ -n "$OID" ] && [ "$OID" != "null" ] && ok "booking created ($(jq -r .invoiceNo <<<"$ORDER"))" || die "checkout failed"
[ "$(jq -r .status <<<"$ORDER")" = "pending" ] && ok "starts pending" || bad "unexpected initial status"
[ "$(jq -r .total <<<"$ORDER")" -eq "$TOTAL" ] && ok "charged exactly what the cart quoted" || bad "QUOTE/CHARGE MISMATCH"
[ "$(jq -r '.count' <<<"$(req GET /cart)")" = "0" ] && ok "cart cleared after checkout" || bad "cart not cleared"

PAID="$(req POST "/orders/$OID/pay" '{"method":"gcash"}')"
[ "$(jq -r .status <<<"$PAID")" = "payment-confirmed" ] && ok "payment confirmed" || bad "payment did not confirm"
[ "$(jq -r .payment.ref <<<"$PAID")" != "null" ] && ok "payment reference recorded" || bad "no payment reference"
[ "$(code POST "/orders/$OID/pay" '{"method":"gcash"}')" = "409" ] && ok "double payment refused" || bad "double payment allowed"

DETAIL="$(req GET "/orders/$OID")"
[ "$(jq -r .invoiceNo <<<"$DETAIL")" != "null" ] && ok "invoice number on the detail read" || bad "invoiceNo missing"
[ "$(jq -r '.statusHistory | length' <<<"$DETAIL")" -ge 2 ] && ok "status history recorded" || bad "history not written"

[ "$(jq -r .unread <<<"$(req GET /notifications)")" -ge 2 ] && ok "booking + payment notifications raised" || bad "order notifications missing"

# ----------------------------------------------------------
step '6. Support desk'

TICKET="$(req POST /support "$(jq -nc --arg e "$EMAIL" \
  '{name:"Smoke Test",email:$e,subject:"Smoke ticket",category:"booking",message:"This is an automated smoke-test message."}')")"
[ "$(jq -r .ok <<<"$TICKET")" = "true" ] && ok "support ticket created ($(jq -r .ref <<<"$TICKET"))" || bad "support submit failed"
[ "$(jq -r '.tickets | length' <<<"$(req GET /support/mine)")" -ge 1 ] && ok "ticket visible to its author" || bad "own ticket not listed"
[ "$(code POST /support '{"name":"x","email":"bad","message":"too short"}')" = "400" ] && ok "invalid ticket rejected" || bad "validation too loose"

# ----------------------------------------------------------
step '7. Authorization boundaries'

[ "$(code GET /users)" = "403" ]           && ok "user list refused to a customer" || bad "USER LIST EXPOSED"
[ "$(code GET /audit)" = "403" ]           && ok "audit trail refused to a customer" || bad "AUDIT TRAIL EXPOSED"
[ "$(code GET /orders/reports/summary)" = "403" ] && ok "reports refused to a customer" || bad "REPORTS EXPOSED"
[ "$(code PUT /settings '{"deliveryFee":0}')" = "403" ] && ok "settings write refused" || bad "SETTINGS WRITABLE BY CUSTOMER"
[ "$(code PUT /pages/about '{"title":"x"}')" = "403" ]   && ok "CMS write refused" || bad "CMS WRITABLE BY CUSTOMER"
[ "$(code POST /products '{"name":"x","brand":"y"}')" = "403" ] && ok "product create refused" || bad "CATALOG WRITABLE BY CUSTOMER"

TOKEN=""
[ "$(code GET /cart)" = "401" ] && ok "cart needs a session" || bad "cart readable anonymously"
[ "$(code GET /wishlist)" = "401" ] && ok "wishlist needs a session" || bad "wishlist readable anonymously"
[ "$(code GET /api/nope)" != "200" ] && ok "unknown endpoint does not 200" || bad "unknown endpoint returned 200"

# ----------------------------------------------------------
step '8. Password reset'

RESET="$(req POST /auth/forgot-password "$(jq -nc --arg e "$EMAIL" '{email:$e}')")"
[ "$(jq -r .ok <<<"$RESET")" = "true" ] && ok "reset requested" || bad "reset request failed"
# Unknown addresses must look identical — no account enumeration.
UNKNOWN="$(req POST /auth/forgot-password '{"email":"definitely-not-registered@dialux.test"}')"
[ "$(jq -r .message <<<"$RESET")" = "$(jq -r .message <<<"$UNKNOWN")" ] \
  && ok "no account enumeration in the reset response" || bad "RESET LEAKS WHETHER AN EMAIL EXISTS"
[ "$(code POST /auth/reset-password '{"token":"garbage","password":"whatever123"}')" = "400" ] \
  && ok "forged reset token rejected" || bad "FORGED RESET TOKEN ACCEPTED"

# ----------------------------------------------------------
printf '\n\033[1mResult:\033[0m %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
printf '\033[32mAll smoke checks passed.\033[0m\n'
