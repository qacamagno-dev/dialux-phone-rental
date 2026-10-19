// ============================================================
// DiaLux — database seed
//
//   npm run seed                          seed the catalog
//   npm run seed -- --admin=me@mail.com   also promote that user to admin
//   npm run seed -- --rider=me@mail.com   also promote that user to rider
//   npm run seed -- --technician=me@mail.com   ...or to technician (inspections)
//   npm run seed -- --reset               delete existing products first
//
// Products are upserted by name, so re-running is safe and will not
// create duplicates.
// ============================================================

require('dotenv').config();
const mongoose = require('mongoose');
const https = require('https');
const fs = require('fs');
const path = require('path');
const Product = require('./models/Product');
const User = require('./models/User');

const args = process.argv.slice(2);
const getFlag = (name) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const CATALOG = [
  // ---------------- phones ----------------
  {
    name: 'iPhone 15 Pro Max', brand: 'Apple', cat: 'phone', grade: 'Like New',
    daily: 800, weekly: 4500, monthly: 12000, deposit: 15000, stock: 3,
    desc: 'The biggest Pro — A17 Pro, titanium build, and a 5× tetraprism telephoto.',
    specs: {
      Display: '6.7" Super Retina XDR OLED, 120Hz',
      Chipset: 'Apple A17 Pro',
      RAM: '8 GB',
      Storage: '256 GB',
      'Rear camera': '48MP main + 12MP ultrawide + 12MP 5× telephoto',
      Zoom: '5× optical, 25× digital',
      'Front camera': '12MP TrueDepth',
      Battery: '4422 mAh · 98% health',
      Charging: 'USB-C · 27W wired · MagSafe',
      OS: 'iOS 17',
    },
    included: ['USB-C cable', '20W adapter', 'Clear case'],
  },
  {
    name: 'iPhone 15 Pro', brand: 'Apple', cat: 'phone', grade: 'Good',
    daily: 650, weekly: 3500, monthly: 9500, deposit: 12000, stock: 4,
    desc: 'Titanium flagship with the A17 Pro chip and a 3x telephoto camera.',
    specs: {
      Display: '6.1" Super Retina XDR OLED, 120Hz',
      Chipset: 'Apple A17 Pro',
      RAM: '8 GB',
      Storage: '128 GB',
      'Rear camera': '48MP main + 12MP ultrawide + 12MP telephoto',
      Zoom: '3× optical, 15× digital',
      'Front camera': '12MP TrueDepth',
      Battery: '3274 mAh · 92% health',
      Charging: 'USB-C · 20W wired · MagSafe',
      OS: 'iOS 17',
    },
    included: ['USB-C cable', '20W adapter'],
  },
  {
    name: 'iPhone 15', brand: 'Apple', cat: 'phone', grade: 'Like New',
    daily: 550, weekly: 3000, monthly: 8000, deposit: 10000, stock: 6,
    desc: 'The balanced iPhone — Dynamic Island, USB-C, and a 48MP main camera.',
    specs: {
      Display: '6.1" Super Retina XDR OLED, 60Hz',
      Chipset: 'Apple A16 Bionic',
      RAM: '6 GB',
      Storage: '128 GB',
      'Rear camera': '48MP main + 12MP ultrawide',
      Zoom: '2× optical (in-sensor), 10× digital',
      'Front camera': '12MP TrueDepth',
      Battery: '3349 mAh · 96% health',
      Charging: 'USB-C · 20W wired · MagSafe',
      OS: 'iOS 17',
    },
    included: ['USB-C cable', '20W adapter'],
  },
  {
    name: 'iPhone 14 Pro Max', brand: 'Apple', cat: 'phone', grade: 'Like New',
    daily: 500, weekly: 2800, monthly: 7500, deposit: 10000, stock: 3,
    desc: 'Dynamic Island debut — 48MP main and an always-on ProMotion display.',
    specs: {
      Display: '6.7" Super Retina XDR OLED, 120Hz ProMotion',
      Chipset: 'Apple A16 Bionic',
      RAM: '6 GB',
      Storage: '256 GB',
      'Rear camera': '48MP main + 12MP ultrawide + 12MP telephoto',
      Zoom: '3× optical, 15× digital',
      'Front camera': '12MP TrueDepth',
      Battery: '4323 mAh · 95% health',
      Charging: 'Lightning · 27W wired · MagSafe',
      OS: 'iOS 16',
    },
    included: ['Lightning cable', '20W adapter', 'Clear case'],
  },
  {
    name: 'iPhone 14 Pro', brand: 'Apple', cat: 'phone', grade: 'Fair',
    daily: 420, weekly: 2300, monthly: 6000, deposit: 8000, stock: 4,
    desc: 'Compact Pro with Dynamic Island and a 48MP quad-pixel camera.',
    specs: {
      Display: '6.1" Super Retina XDR OLED, 120Hz ProMotion',
      Chipset: 'Apple A16 Bionic',
      RAM: '6 GB',
      Storage: '128 GB',
      'Rear camera': '48MP main + 12MP ultrawide + 12MP telephoto',
      Zoom: '3× optical, 15× digital',
      'Front camera': '12MP TrueDepth',
      Battery: '3200 mAh · 88% health',
      Charging: 'Lightning · 27W wired · MagSafe',
      OS: 'iOS 16',
    },
    included: ['Lightning cable', '20W adapter'],
  },
  {
    name: 'iPhone 13', brand: 'Apple', cat: 'phone', grade: 'Good',
    daily: 320, weekly: 1800, monthly: 4500, deposit: 5000, stock: 5,
    desc: 'Dependable everyday iPhone — dual 12MP cameras and all-day battery.',
    specs: {
      Display: '6.1" Super Retina XDR OLED, 60Hz',
      Chipset: 'Apple A15 Bionic',
      RAM: '4 GB',
      Storage: '128 GB',
      'Rear camera': '12MP main + 12MP ultrawide',
      Zoom: '2× optical (crop), 5× digital',
      'Front camera': '12MP TrueDepth',
      Battery: '3240 mAh · 90% health',
      Charging: 'Lightning · 20W wired · MagSafe',
      OS: 'iOS 15',
    },
    included: ['Lightning cable'],
  },
  {
    name: 'iPhone 12 Pro', brand: 'Apple', cat: 'phone', grade: 'Fair',
    daily: 280, weekly: 1500, monthly: 3800, deposit: 4000, stock: 4,
    desc: 'Still-sharp OLED, LiDAR, and a triple 12MP camera with 2× telephoto.',
    specs: {
      Display: '6.1" Super Retina XDR OLED, 60Hz',
      Chipset: 'Apple A14 Bionic',
      RAM: '6 GB',
      Storage: '128 GB',
      'Rear camera': '12MP main + 12MP ultrawide + 12MP telephoto',
      Zoom: '2× optical, 10× digital',
      'Front camera': '12MP TrueDepth',
      Battery: '2815 mAh · 85% health',
      Charging: 'Lightning · 20W wired · MagSafe',
      OS: 'iOS 14',
    },
    included: ['Lightning cable'],
  },
  {
    name: 'iPhone 12', brand: 'Apple', cat: 'phone', grade: 'Good',
    daily: 250, weekly: 1300, monthly: 3300, deposit: 3500, stock: 5,
    desc: 'The phone that brought OLED and 5G to the standard iPhone line.',
    specs: {
      Display: '6.1" Super Retina XDR OLED, 60Hz',
      Chipset: 'Apple A14 Bionic',
      RAM: '4 GB',
      Storage: '64 GB',
      'Rear camera': '12MP main + 12MP ultrawide',
      Zoom: '2× optical (crop), 5× digital',
      'Front camera': '12MP TrueDepth',
      Battery: '2815 mAh · 89% health',
      Charging: 'Lightning · 20W wired · MagSafe',
      OS: 'iOS 14',
    },
    included: ['Lightning cable'],
  },
  {
    name: 'Galaxy S24 Ultra', brand: 'Samsung', cat: 'phone', grade: 'Like New',
    daily: 750, weekly: 4200, monthly: 11000, deposit: 15000, stock: 4,
    desc: 'Built-in S Pen, 200MP camera, and the brightest panel Samsung ships.',
    specs: {
      Display: '6.8" QHD+ Dynamic AMOLED 2X, 120Hz',
      Chipset: 'Snapdragon 8 Gen 3 for Galaxy',
      RAM: '12 GB',
      Storage: '256 GB',
      'Rear camera': '200MP main + 12MP UW + 50MP + 10MP tele',
      Zoom: '3× & 5× optical, up to 100× Space Zoom',
      'Front camera': '12MP',
      Battery: '5000 mAh · 97% health',
      Charging: '45W wired · 15W wireless',
      OS: 'Android 14 · One UI 6.1',
    },
    included: ['USB-C cable', 'S Pen', 'Protective case'],
  },
  {
    name: 'Galaxy S24+', brand: 'Samsung', cat: 'phone', grade: 'Like New',
    daily: 600, weekly: 3300, monthly: 8500, deposit: 10000, stock: 3,
    desc: 'Big, bright QHD+ screen with Galaxy AI and a 4,900 mAh battery.',
    specs: {
      Display: '6.7" QHD+ Dynamic AMOLED 2X, 120Hz',
      Chipset: 'Exynos 2400',
      RAM: '12 GB',
      Storage: '256 GB',
      'Rear camera': '50MP main + 12MP ultrawide + 10MP telephoto',
      Zoom: '3× optical, 30× Space Zoom',
      'Front camera': '12MP',
      Battery: '4900 mAh',
      Charging: '45W wired · 15W wireless',
      OS: 'Android 14 · One UI 6.1',
    },
    included: ['USB-C cable', 'Protective case'],
  },
  {
    name: 'Galaxy S23 Ultra', brand: 'Samsung', cat: 'phone', grade: 'Good',
    daily: 550, weekly: 3000, monthly: 7800, deposit: 10000, stock: 3,
    desc: '200MP camera and a built-in S Pen — a recent flagship, still elite.',
    specs: {
      Display: '6.8" QHD+ Dynamic AMOLED 2X, 120Hz',
      Chipset: 'Snapdragon 8 Gen 2 for Galaxy',
      RAM: '8 GB',
      Storage: '256 GB',
      'Rear camera': '200MP main + 12MP UW + 10MP + 10MP tele',
      Zoom: '3× & 10× optical, up to 100× Space Zoom',
      'Front camera': '12MP',
      Battery: '5000 mAh · 94% health',
      Charging: '45W wired · 15W wireless',
      OS: 'Android 14 · One UI 6.1',
    },
    included: ['USB-C cable', 'S Pen', 'Protective case'],
  },
  {
    name: 'Galaxy S22 Ultra', brand: 'Samsung', cat: 'phone', grade: 'Good',
    daily: 400, weekly: 2200, monthly: 5500, deposit: 7000, stock: 3,
    desc: 'Note reborn — integrated S Pen, 108MP camera, and 10× space zoom.',
    specs: {
      Display: '6.8" QHD+ Dynamic AMOLED 2X, 120Hz',
      Chipset: 'Snapdragon 8 Gen 1',
      RAM: '12 GB',
      Storage: '256 GB',
      'Rear camera': '108MP main + 12MP UW + 10MP + 10MP tele',
      Zoom: '3× & 10× optical, up to 100× Space Zoom',
      'Front camera': '40MP',
      Battery: '5000 mAh · 90% health',
      Charging: '45W wired · 15W wireless',
      OS: 'Android 14 · One UI 6.1',
    },
    included: ['USB-C cable', 'S Pen', 'Protective case'],
  },
  {
    name: 'Galaxy S22', brand: 'Samsung', cat: 'phone', grade: 'Fair',
    daily: 300, weekly: 1700, monthly: 4200, deposit: 4500, stock: 4,
    desc: 'Compact flagship with a 50MP camera and a bright 120Hz screen.',
    specs: {
      Display: '6.1" FHD+ Dynamic AMOLED 2X, 120Hz',
      Chipset: 'Snapdragon 8 Gen 1',
      RAM: '8 GB',
      Storage: '128 GB',
      'Rear camera': '50MP main + 12MP ultrawide + 10MP telephoto',
      Zoom: '3× optical, 30× Space Zoom',
      'Front camera': '10MP',
      Battery: '3700 mAh · 86% health',
      Charging: '25W wired · 15W wireless',
      OS: 'Android 14 · One UI 6.1',
    },
    included: ['USB-C cable'],
  },
  {
    name: 'Galaxy Z Fold 5', brand: 'Samsung', cat: 'phone', grade: 'Like New',
    daily: 900, weekly: 5000, monthly: 13000, deposit: 18000, stock: 2,
    desc: 'Folds open to a 7.6″ tablet — true multitasking with S Pen support.',
    specs: {
      'Main display': '7.6" QXGA+ Foldable AMOLED, 120Hz',
      'Cover display': '6.2" HD+ AMOLED, 120Hz',
      Chipset: 'Snapdragon 8 Gen 2 for Galaxy',
      RAM: '12 GB',
      Storage: '512 GB',
      'Rear camera': '50MP main + 12MP UW + 10MP telephoto',
      Zoom: '3× optical, 30× Space Zoom',
      'Front camera': '10MP cover + 4MP under-display',
      Battery: '4400 mAh',
      Charging: '25W wired · 15W wireless',
      OS: 'Android 13 · One UI 5.1',
    },
    included: ['USB-C cable', 'Protective case'],
  },
  {
    name: 'Galaxy Z Flip 5', brand: 'Samsung', cat: 'phone', grade: 'Good',
    daily: 600, weekly: 3300, monthly: 8500, deposit: 10000, stock: 3,
    desc: 'Pocketable flip phone with a big 3.4″ cover screen for quick glances.',
    specs: {
      'Main display': '6.7" FHD+ Foldable AMOLED, 120Hz',
      'Cover display': '3.4" Super AMOLED',
      Chipset: 'Snapdragon 8 Gen 2 for Galaxy',
      RAM: '8 GB',
      Storage: '256 GB',
      'Rear camera': '12MP main + 12MP ultrawide',
      Zoom: '2× optical (crop), 10× digital',
      'Front camera': '10MP',
      Battery: '3700 mAh · 93% health',
      Charging: '25W wired · 15W wireless',
      OS: 'Android 13 · One UI 5.1',
    },
    included: ['USB-C cable', 'Protective case'],
  },
  {
    name: 'Pixel 8 Pro', brand: 'Google', cat: 'phone', grade: 'Like New',
    daily: 550, weekly: 3000, monthly: 7800, deposit: 10000, stock: 3,
    desc: 'Tensor G3 with the cleanest Android build and best-in-class photo editing.',
    specs: {
      Display: '6.7" QHD+ LTPO OLED, 120Hz',
      Chipset: 'Google Tensor G3',
      RAM: '12 GB',
      Storage: '128 GB',
      'Rear camera': '50MP main + 48MP ultrawide + 48MP telephoto',
      Zoom: '5× optical, up to 30× Super Res',
      'Front camera': '10.5MP',
      Battery: '5050 mAh · 96% health',
      Charging: '30W wired · Qi wireless',
      OS: 'Android 14',
    },
    included: ['USB-C cable', 'SIM tool'],
  },
  {
    name: 'Pixel 7 Pro', brand: 'Google', cat: 'phone', grade: 'Good',
    daily: 400, weekly: 2200, monthly: 5500, deposit: 6500, stock: 3,
    desc: 'Tensor G2 with a 5× periscope zoom and clean, fast Android.',
    specs: {
      Display: '6.7" QHD+ LTPO OLED, 120Hz',
      Chipset: 'Google Tensor G2',
      RAM: '12 GB',
      Storage: '128 GB',
      'Rear camera': '50MP main + 12MP ultrawide + 48MP telephoto',
      Zoom: '5× optical, up to 30× Super Res',
      'Front camera': '10.8MP',
      Battery: '5000 mAh · 92% health',
      Charging: '23W wired · Qi wireless',
      OS: 'Android 14',
    },
    included: ['USB-C cable', 'SIM tool'],
  },
  {
    name: 'Pixel 6 Pro', brand: 'Google', cat: 'phone', grade: 'Good',
    daily: 300, weekly: 1700, monthly: 4200, deposit: 4500, stock: 4,
    desc: 'The first Google Tensor phone — 50MP sensor and 4× periscope zoom.',
    specs: {
      Display: '6.71" QHD+ LTPO OLED, 120Hz',
      Chipset: 'Google Tensor',
      RAM: '12 GB',
      Storage: '128 GB',
      'Rear camera': '50MP main + 12MP ultrawide + 48MP telephoto',
      Zoom: '4× optical, up to 20× Super Res',
      'Front camera': '11.1MP',
      Battery: '5003 mAh · 88% health',
      Charging: '30W wired · Qi wireless',
      OS: 'Android 14',
    },
    included: ['USB-C cable', 'SIM tool'],
  },
  {
    name: 'OnePlus 12', brand: 'OnePlus', cat: 'phone', grade: 'Like New',
    daily: 500, weekly: 2800, monthly: 7000, deposit: 8000, stock: 3,
    desc: 'Snapdragon 8 Gen 3 with 100W fast charging and a Hasselblad camera.',
    specs: {
      Display: '6.82" QHD+ LTPO AMOLED, 120Hz',
      Chipset: 'Snapdragon 8 Gen 3',
      RAM: '12 GB',
      Storage: '256 GB',
      'Rear camera': '50MP main + 48MP ultrawide + 64MP 3× telephoto',
      Zoom: '3× optical, 6× lossless',
      'Front camera': '32MP',
      Battery: '5400 mAh',
      Charging: '100W SUPERVOOC · 50W wireless',
      OS: 'Android 14 · OxygenOS 14',
    },
    included: ['USB-C cable', '100W adapter', 'Protective case'],
  },
  {
    name: 'OnePlus 11', brand: 'OnePlus', cat: 'phone', grade: 'Good',
    daily: 400, weekly: 2200, monthly: 5500, deposit: 6500, stock: 3,
    desc: 'Snapdragon 8 Gen 2 with Hasselblad color and 100W fast charging.',
    specs: {
      Display: '6.7" QHD+ LTPO AMOLED, 120Hz',
      Chipset: 'Snapdragon 8 Gen 2',
      RAM: '16 GB',
      Storage: '256 GB',
      'Rear camera': '50MP main + 48MP ultrawide + 32MP telephoto',
      Zoom: '2× optical, 20× digital',
      'Front camera': '16MP',
      Battery: '5000 mAh',
      Charging: '100W SUPERVOOC',
      OS: 'Android 14 · OxygenOS 14',
    },
    included: ['USB-C cable', '100W adapter'],
  },
  {
    name: 'Xiaomi 14 Pro', brand: 'Xiaomi', cat: 'phone', grade: 'Like New',
    daily: 500, weekly: 2800, monthly: 7000, deposit: 8000, stock: 2,
    desc: 'Leica optics, a variable-aperture main camera, and 120W charging.',
    specs: {
      Display: '6.73" WQHD+ LTPO AMOLED, 120Hz',
      Chipset: 'Snapdragon 8 Gen 3',
      RAM: '12 GB',
      Storage: '256 GB',
      'Rear camera': '50MP Leica main + 50MP UW + 50MP telephoto',
      Zoom: '3.2× optical',
      'Front camera': '32MP',
      Battery: '4880 mAh',
      Charging: '120W wired · 50W wireless',
      OS: 'Android 14 · HyperOS',
    },
    included: ['USB-C cable', '120W adapter'],
  },
  {
    name: 'Xiaomi 13 Pro', brand: 'Xiaomi', cat: 'phone', grade: 'Good',
    daily: 400, weekly: 2200, monthly: 5500, deposit: 6500, stock: 3,
    desc: 'A 1-inch Leica main sensor and 120W HyperCharge in a ceramic body.',
    specs: {
      Display: '6.73" WQHD+ LTPO AMOLED, 120Hz',
      Chipset: 'Snapdragon 8 Gen 2',
      RAM: '12 GB',
      Storage: '256 GB',
      'Rear camera': '50MP 1" Leica main + 50MP UW + 50MP telephoto',
      Zoom: '3.2× optical, 70× digital',
      'Front camera': '32MP',
      Battery: '4820 mAh',
      Charging: '120W wired · 50W wireless',
      OS: 'Android 14 · HyperOS',
    },
    included: ['USB-C cable', '120W adapter'],
  },
  {
    name: 'ASUS ROG Phone 8 Pro', brand: 'ASUS', cat: 'phone', grade: 'Good',
    daily: 600, weekly: 3300, monthly: 8500, deposit: 10000, stock: 2,
    desc: 'Gaming beast — 165Hz display, AirTrigger controls, and a huge battery.',
    specs: {
      Display: '6.78" FHD+ LTPO AMOLED, 165Hz',
      Chipset: 'Snapdragon 8 Gen 3',
      RAM: '16 GB',
      Storage: '512 GB',
      'Rear camera': '50MP main + 13MP UW + 32MP telephoto',
      Zoom: '3× optical',
      'Front camera': '32MP',
      Battery: '5500 mAh',
      Charging: '65W wired · 15W wireless',
      Extras: 'AirTrigger · AeroActive cooler',
      OS: 'Android 14',
    },
    included: ['USB-C cable', '65W adapter', 'AeroActive Cooler X'],
  },
  {
    name: 'Sony Xperia 1 V', brand: 'Sony', cat: 'phone', grade: 'Like New',
    daily: 600, weekly: 3300, monthly: 8500, deposit: 10000, stock: 2,
    desc: '4K OLED, pro camera controls, and a real 3.5mm jack for creators.',
    specs: {
      Display: '6.5" 4K HDR OLED, 120Hz',
      Chipset: 'Snapdragon 8 Gen 2',
      RAM: '12 GB',
      Storage: '256 GB',
      'Rear camera': '48MP main + 12MP UW + 12MP variable telephoto',
      Zoom: '3.5×–5.2× continuous optical',
      'Front camera': '12MP',
      Battery: '5000 mAh',
      Charging: '30W wired · Qi wireless',
      Extras: '3.5mm jack · microSD',
      OS: 'Android 14',
    },
    included: ['USB-C cable'],
  },
  {
    name: 'Nothing Phone (2)', brand: 'Nothing', cat: 'phone', grade: 'Like New',
    daily: 350, weekly: 1900, monthly: 5000, deposit: 6000, stock: 3,
    desc: 'Transparent design with the signature Glyph LED lighting on the back.',
    specs: {
      Display: '6.7" LTPO OLED, 120Hz',
      Chipset: 'Snapdragon 8+ Gen 1',
      RAM: '12 GB',
      Storage: '256 GB',
      'Rear camera': '50MP main + 50MP ultrawide',
      Zoom: '2× in-sensor, 10× digital',
      'Front camera': '32MP',
      Battery: '4700 mAh',
      Charging: '45W wired · 15W wireless',
      Extras: 'Glyph Interface',
      OS: 'Android 14 · Nothing OS 2.5',
    },
    included: ['USB-C cable'],
  },
  {
    name: 'Huawei P60 Pro', brand: 'Huawei', cat: 'phone', grade: 'Good',
    daily: 450, weekly: 2500, monthly: 6500, deposit: 7000, stock: 2,
    desc: 'Variable-aperture 48MP camera and an ultra-bright Kunlun-glass screen.',
    specs: {
      Display: '6.67" LTPO OLED, 120Hz',
      Chipset: 'Snapdragon 8+ Gen 1 (4G)',
      RAM: '8 GB',
      Storage: '256 GB',
      'Rear camera': '48MP variable-aperture main + 13MP UW + 48MP telephoto',
      Zoom: '3.5× optical, 100× digital',
      'Front camera': '13MP',
      Battery: '4815 mAh',
      Charging: '88W wired · 50W wireless',
      OS: 'HarmonyOS 3.1',
      Note: 'No Google services',
    },
    included: ['USB-C cable', '88W adapter'],
  },
  {
    name: 'POCO F5 Pro', brand: 'POCO', cat: 'phone', grade: 'Like New',
    daily: 280, weekly: 1500, monthly: 3800, deposit: 4000, stock: 3,
    desc: 'Flagship-grade Snapdragon and a QHD+ 120Hz screen at a value price.',
    specs: {
      Display: '6.67" WQHD+ AMOLED, 120Hz',
      Chipset: 'Snapdragon 8+ Gen 1',
      RAM: '12 GB',
      Storage: '256 GB',
      'Rear camera': '64MP main + 8MP ultrawide + 2MP macro',
      Zoom: '2× in-sensor, 10× digital',
      'Front camera': '16MP',
      Battery: '5160 mAh',
      Charging: '67W wired · 30W wireless',
      OS: 'Android 13 · MIUI 14',
    },
    included: ['USB-C cable', '67W adapter'],
  },
  {
    name: 'POCO X7', brand: 'POCO', cat: 'phone', grade: 'Like New',
    daily: 180, weekly: 950, monthly: 2500, deposit: 2500, stock: 4,
    desc: 'Curved 1.5K AMOLED and a 5110 mAh battery — the budget all-rounder.',
    specs: {
      Display: '6.67" 1.5K AMOLED, 120Hz · HDR10+',
      Chipset: 'MediaTek Dimensity 7300 Ultra',
      RAM: '8 GB',
      Storage: '256 GB',
      'Rear camera': '50MP main + 8MP ultrawide + 2MP macro',
      Zoom: '2× in-sensor, 10× digital',
      'Front camera': '20MP',
      Battery: '5110 mAh',
      Charging: '45W wired',
      OS: 'Android 14 · HyperOS',
    },
    included: ['USB-C cable', '45W adapter', 'Clear case'],
  },
  {
    name: 'POCO X7 Pro', brand: 'POCO', cat: 'phone', grade: 'Like New',
    daily: 220, weekly: 1200, monthly: 3000, deposit: 3000, stock: 4,
    desc: 'Dimensity 8400 Ultra and a 6000 mAh cell — flagship speed, midrange price.',
    specs: {
      Display: '6.67" 1.5K AMOLED, 120Hz · HDR10+',
      Chipset: 'MediaTek Dimensity 8400 Ultra',
      RAM: '12 GB',
      Storage: '256 GB · UFS 4.0',
      'Rear camera': '50MP main (OIS) + 8MP ultrawide',
      Zoom: '2× in-sensor, 10× digital',
      'Front camera': '20MP',
      Battery: '6000 mAh',
      Charging: '90W HyperCharge',
      OS: 'Android 15 · HyperOS 2',
    },
    included: ['USB-C cable', '90W adapter', 'Clear case'],
  },
  {
    name: 'POCO X8 Pro', brand: 'POCO', cat: 'phone', grade: 'Like New',
    daily: 240, weekly: 1300, monthly: 3300, deposit: 3500, stock: 3,
    desc: 'Dimensity 8500 Ultra, Gorilla Glass 7i, and a 6500 mAh battery.',
    specs: {
      Display: '6.59" 1.5K AMOLED, 120Hz · Gorilla Glass 7i',
      Chipset: 'MediaTek Dimensity 8500 Ultra',
      RAM: '12 GB · LPDDR5X',
      Storage: '256 GB · UFS 4.1',
      'Rear camera': '50MP main (OIS) + 8MP ultrawide',
      Zoom: '2× in-sensor, 10× digital',
      'Front camera': '20MP',
      Battery: '6500 mAh',
      Charging: '100W HyperCharge',
      OS: 'Android 16 · HyperOS 3',
    },
    included: ['USB-C cable', '100W adapter', 'Clear case'],
  },
  {
    name: 'POCO F7', brand: 'POCO', cat: 'phone', grade: 'Like New',
    daily: 240, weekly: 1300, monthly: 3300, deposit: 3500, stock: 3,
    desc: 'A huge 6500 mAh battery behind a 1.5K flat AMOLED — the endurance pick.',
    specs: {
      Display: '6.83" 1.5K AMOLED, 120Hz',
      Chipset: 'Snapdragon 8s Gen 4',
      RAM: '12 GB',
      Storage: '256 GB · UFS 4.1',
      'Rear camera': '50MP Sony IMX882 main (OIS) + 8MP ultrawide',
      Zoom: '2× in-sensor, 10× digital',
      'Front camera': '20MP',
      Battery: '6500 mAh',
      Charging: '90W HyperCharge',
      OS: 'Android 15 · HyperOS 2',
    },
    included: ['USB-C cable', '90W adapter', 'Clear case'],
  },
  {
    name: 'POCO F7 Pro', brand: 'POCO', cat: 'phone', grade: 'Good',
    daily: 280, weekly: 1500, monthly: 3800, deposit: 4000, stock: 3,
    desc: 'The Redmi K80 in global clothing — Snapdragon 8 Gen 3 and a 6000 mAh cell.',
    specs: {
      Display: '6.67" 1.5K AMOLED, 120Hz',
      Chipset: 'Snapdragon 8 Gen 3',
      RAM: '12 GB · LPDDR5X',
      Storage: '256 GB · UFS 4.0',
      'Rear camera': '50MP main (OIS) + 8MP ultrawide',
      Zoom: '2× in-sensor, 10× digital',
      'Front camera': '20MP',
      Battery: '6000 mAh',
      Charging: '90W HyperCharge',
      OS: 'Android 15 · HyperOS 2',
    },
    included: ['USB-C cable', '90W adapter', 'Clear case'],
  },
  {
    name: 'POCO F7 Ultra', brand: 'POCO', cat: 'phone', grade: 'Like New',
    daily: 350, weekly: 1900, monthly: 5000, deposit: 6000, stock: 2,
    desc: 'Snapdragon 8 Elite with a real telephoto — POCO’s first true flagship.',
    specs: {
      Display: '6.67" 1.5K AMOLED, 120Hz',
      Chipset: 'Snapdragon 8 Elite',
      RAM: '16 GB · LPDDR5X',
      Storage: '512 GB · UFS 4.1',
      'Rear camera': '50MP main (OIS) + 32MP ultrawide + 50MP telephoto',
      Zoom: '2.5× optical, 20× digital',
      'Front camera': '32MP',
      Battery: '5300 mAh',
      Charging: '120W wired · 50W wireless',
      OS: 'Android 15 · HyperOS 2',
    },
    included: ['USB-C cable', '120W adapter', 'Clear case'],
  },
  {
    name: 'POCO F8 Pro', brand: 'POCO', cat: 'phone', grade: 'Like New',
    daily: 320, weekly: 1800, monthly: 4500, deposit: 5000, stock: 2,
    desc: 'Snapdragon 8 Elite Gen 5 in a compact 1.5K body — the Redmi K90 abroad.',
    specs: {
      Display: '6.59" 1.5K AMOLED, 120Hz',
      Chipset: 'Snapdragon 8 Elite Gen 5',
      RAM: '12 GB · LPDDR5X',
      Storage: '256 GB · UFS 4.1',
      'Rear camera': '50MP main (OIS) + 50MP telephoto + 8MP ultrawide',
      Zoom: '2× optical, 20× digital',
      'Front camera': '20MP',
      Battery: '6210 mAh',
      Charging: '100W wired · 22.5W wireless',
      OS: 'Android 16 · HyperOS 3',
    },
    included: ['USB-C cable', '100W adapter', 'Clear case'],
  },
  {
    name: 'POCO F8 Ultra', brand: 'POCO', cat: 'phone', grade: 'Like New',
    daily: 450, weekly: 2500, monthly: 6500, deposit: 7000, stock: 2,
    desc: 'The Redmi K90 Pro Max globally — 2K display, periscope zoom, 7000 mAh.',
    specs: {
      Display: '6.9" 2K AMOLED, 120Hz',
      Chipset: 'Snapdragon 8 Elite Gen 5',
      RAM: '16 GB · LPDDR5X',
      Storage: '512 GB · UFS 4.1',
      'Rear camera': '50MP main (OIS) + 50MP periscope + 50MP ultrawide',
      Zoom: '5× optical, 20× digital',
      'Front camera': '32MP',
      Battery: '7000 mAh',
      Charging: '100W wired · 50W wireless',
      Audio: 'Bass speaker tuned with Bose',
      OS: 'Android 16 · HyperOS 3',
    },
    included: ['USB-C cable', '100W adapter', 'Clear case'],
  },

  // ---------------- tablets ----------------
  {
    name: 'iPad Pro 12.9" (M2)', brand: 'Apple', cat: 'tablet', grade: 'Like New',
    daily: 750, weekly: 4200, monthly: 11000, deposit: 15000, stock: 2,
    desc: 'Mini-LED Liquid Retina XDR and M2 — a laptop-class tablet for creatives.',
    specs: {
      Display: '12.9" Liquid Retina XDR mini-LED, 120Hz ProMotion',
      Chipset: 'Apple M2',
      RAM: '8 GB',
      Storage: '256 GB',
      'Rear camera': '12MP Wide + 10MP UW + LiDAR',
      'Front camera': '12MP Ultrawide · Center Stage',
      Battery: 'Up to 10 hrs',
      Connectivity: 'Wi-Fi 6E',
      Ports: 'USB-C / Thunderbolt 4',
      Stylus: 'Apple Pencil (2nd gen)',
    },
    included: ['USB-C cable', '20W adapter', 'Folio cover'],
  },
  {
    name: 'iPad Pro 11"', brand: 'Apple', cat: 'tablet', grade: 'Like New',
    daily: 650, weekly: 3500, monthly: 9500, deposit: 12000, stock: 2,
    desc: 'Tandem OLED and M4 — the tablet that genuinely replaces a laptop.',
    specs: {
      Display: '11" Ultra Retina XDR OLED, 120Hz ProMotion',
      Chipset: 'Apple M4',
      RAM: '8 GB',
      Storage: '256 GB',
      'Rear camera': '12MP Wide + LiDAR',
      'Front camera': '12MP Ultrawide · Center Stage',
      Battery: 'Up to 10 hrs',
      Connectivity: 'Wi-Fi 6E',
      Ports: 'USB-C / Thunderbolt 4',
      Stylus: 'Apple Pencil Pro',
    },
    included: ['USB-C cable', '20W adapter', 'Folio cover'],
  },
  {
    name: 'iPad Air M2', brand: 'Apple', cat: 'tablet', grade: 'Like New',
    daily: 450, weekly: 2500, monthly: 6500, deposit: 7000, stock: 4,
    desc: 'M2 power in a thin chassis — ideal for note-taking and light editing.',
    specs: {
      Display: '11" Liquid Retina, 60Hz',
      Chipset: 'Apple M2',
      RAM: '8 GB',
      Storage: '128 GB',
      'Rear camera': '12MP Wide',
      'Front camera': '12MP Ultrawide · Center Stage',
      Battery: 'Up to 10 hrs',
      Connectivity: 'Wi-Fi 6E',
      Ports: 'USB-C',
      Stylus: 'Apple Pencil Pro / USB-C',
    },
    included: ['USB-C cable', '20W adapter'],
  },
  {
    name: 'iPad Air (5th Gen)', brand: 'Apple', cat: 'tablet', grade: 'Good',
    daily: 350, weekly: 1900, monthly: 5000, deposit: 6000, stock: 4,
    desc: 'M1 power in the thin Air body — great for notes, streaming, and study.',
    specs: {
      Display: '10.9" Liquid Retina, 60Hz',
      Chipset: 'Apple M1',
      RAM: '8 GB',
      Storage: '64 GB',
      'Rear camera': '12MP Wide',
      'Front camera': '12MP Ultrawide · Center Stage',
      Battery: 'Up to 10 hrs',
      Connectivity: 'Wi-Fi 6',
      Ports: 'USB-C',
      Stylus: 'Apple Pencil (2nd gen)',
    },
    included: ['USB-C cable', '20W adapter'],
  },
  {
    name: 'Galaxy Tab S9 Ultra', brand: 'Samsung', cat: 'tablet', grade: 'Like New',
    daily: 700, weekly: 3900, monthly: 10000, deposit: 14000, stock: 2,
    desc: 'Massive 14.6″ AMOLED tablet with S Pen and DeX — a laptop alternative.',
    specs: {
      Display: '14.6" Dynamic AMOLED 2X, 120Hz',
      Chipset: 'Snapdragon 8 Gen 2 for Galaxy',
      RAM: '12 GB',
      Storage: '512 GB',
      'Rear camera': '13MP + 8MP ultrawide',
      'Front camera': '12MP + 12MP ultrawide',
      Battery: '11200 mAh',
      Connectivity: 'Wi-Fi 6E',
      Ports: 'USB-C 3.2',
      Extras: 'S Pen included · IP68',
    },
    included: ['USB-C cable', 'S Pen', 'Book cover keyboard'],
  },
  {
    name: 'Galaxy Tab S9', brand: 'Samsung', cat: 'tablet', grade: 'Fair',
    daily: 500, weekly: 2800, monthly: 7000, deposit: 8000, stock: 5,
    desc: 'AMOLED tablet with an S Pen in the box and DeX desktop mode.',
    specs: {
      Display: '11" Dynamic AMOLED 2X, 120Hz',
      Chipset: 'Snapdragon 8 Gen 2 for Galaxy',
      RAM: '8 GB',
      Storage: '128 GB',
      'Rear camera': '13MP',
      'Front camera': '12MP Ultrawide',
      Battery: '8400 mAh',
      Connectivity: 'Wi-Fi 6E',
      Ports: 'USB-C 3.2',
      Extras: 'S Pen included · IP68',
    },
    included: ['USB-C cable', 'S Pen'],
  },

  // ---------------- laptops ----------------
  {
    name: 'MacBook Pro 14" M3 Pro', brand: 'Apple', cat: 'laptop', grade: 'Like New',
    daily: 1200, weekly: 6500, monthly: 17000, deposit: 22000, stock: 2,
    desc: 'For rendering, compiling, and colour work — mini-LED and 18 GB unified memory.',
    specs: {
      Display: '14.2" Liquid Retina XDR, 120Hz',
      Chipset: 'Apple M3 Pro · 12-core CPU',
      Graphics: '18-core GPU',
      RAM: '18 GB unified',
      Storage: '512 GB SSD',
      Battery: 'Up to 18 hrs',
      Ports: '3× Thunderbolt 4 · HDMI · SDXC · MagSafe 3',
      Webcam: '1080p FaceTime HD',
      Weight: '1.61 kg',
      OS: 'macOS',
    },
    included: ['96W adapter', 'MagSafe cable', 'Sleeve'],
  },
  {
    name: 'MacBook Air M3 13"', brand: 'Apple', cat: 'laptop', grade: 'Like New',
    daily: 750, weekly: 4200, monthly: 11000, deposit: 15000, stock: 3,
    desc: 'Fanless, silent, and good for a full day of classes on one charge.',
    specs: {
      Display: '13.6" Liquid Retina, 500 nits',
      Chipset: 'Apple M3 · 8-core CPU',
      Graphics: '10-core GPU',
      RAM: '16 GB unified',
      Storage: '512 GB SSD',
      Battery: 'Up to 18 hrs',
      Ports: '2× Thunderbolt / USB-4 · MagSafe 3',
      Webcam: '1080p FaceTime HD',
      Weight: '1.24 kg',
      OS: 'macOS',
    },
    included: ['35W dual-port adapter', 'USB-C cable'],
  },
  {
    name: 'Dell XPS 13 Plus', brand: 'Dell', cat: 'laptop', grade: 'Good',
    daily: 800, weekly: 4500, monthly: 12000, deposit: 15000, stock: 3,
    desc: 'Windows ultrabook with an edge-to-edge keyboard and 3.5K OLED option.',
    specs: {
      Display: '13.4" FHD+ InfinityEdge · 1920×1200',
      Chipset: 'Intel Core i7-1360P',
      Graphics: 'Intel Iris Xe',
      RAM: '16 GB LPDDR5',
      Storage: '512 GB SSD',
      Battery: '55 Wh',
      Ports: '2× Thunderbolt 4 (USB-C)',
      Webcam: '720p HD + IR · Windows Hello',
      Weight: '1.26 kg',
      OS: 'Windows 11',
    },
    included: ['60W USB-C adapter', 'USB-A dongle'],
  },

  // ---------------- pocket Wi-Fi ----------------
  {
    name: 'Globe Pocket Wi-Fi LTE', brand: 'Globe', cat: 'wifi', grade: 'Good',
    daily: 50, weekly: 280, monthly: 800, deposit: 1000, stock: 12,
    desc: 'Share LTE with up to 10 devices. Prepaid load, no lock-in.',
    specs: {
      Network: '4G LTE Cat 4',
      'Max speed': 'Up to 150 Mbps',
      Devices: 'Up to 10',
      Battery: '2000 mAh',
      SIM: 'Globe/TM prepaid · nano',
      Ports: 'Micro-USB',
    },
    included: ['Micro-USB cable', 'Quick-start card'],
  },
  {
    name: 'Smart 5G Pocket Wi-Fi', brand: 'Smart', cat: 'wifi', grade: 'Like New',
    daily: 80, weekly: 450, monthly: 1300, deposit: 1500, stock: 8,
    desc: '5G speeds for a whole group — the pick for events and out-of-town work.',
    specs: {
      Network: '5G Sub-6 · NSA',
      'Max speed': 'Up to 1 Gbps',
      Devices: 'Up to 16',
      Battery: '3000 mAh',
      SIM: 'Smart/TNT prepaid · nano',
      Ports: 'USB-C',
    },
    included: ['USB-C cable', 'Quick-start card'],
  },
];

// ---- product photos ----------------------------------------------------
// Local photos in two folders ship with the repo. Wikipedia is only used as
// a fallback when a product has no local file.
const IMAGE_TITLES = {
  'iPhone 15 Pro Max':      'IPhone_15_Pro',
  'iPhone 15 Pro':          'IPhone_15_Pro',
  'iPhone 15':              'IPhone_15',
  'iPhone 14 Pro Max':      'IPhone_14_Pro',
  'iPhone 14 Pro':          'IPhone_14_Pro',
  'iPhone 13':              'IPhone_13',
  'iPhone 12 Pro':          'IPhone_12_Pro',
  'iPhone 12':              'IPhone_12',
  'Galaxy S24 Ultra':       'Samsung_Galaxy_S24_Ultra',
  'Galaxy S24+':            'Samsung_Galaxy_S24',
  'Galaxy S23 Ultra':       'Samsung_Galaxy_S23_Ultra',
  'Galaxy S22 Ultra':       'Samsung_Galaxy_S22',
  'Galaxy S22':             'Samsung_Galaxy_S22',
  'Galaxy Z Fold 5':        'Samsung_Galaxy_Z_Fold_5',
  'Galaxy Z Flip 5':        'Samsung_Galaxy_Z_Flip_5',
  'Pixel 8 Pro':            'Google_Pixel_8_Pro',
  'Pixel 7 Pro':            'Google_Pixel_7_Pro',
  'Pixel 6 Pro':            'Google_Pixel_6_Pro',
  'OnePlus 12':             'OnePlus_12',
  'OnePlus 11':             'OnePlus_11',
  'Xiaomi 14 Pro':          'Xiaomi_14',
  'Xiaomi 13 Pro':          'Xiaomi_13',
  'ASUS ROG Phone 8 Pro':   'Asus_ROG_Phone_8',
  'Sony Xperia 1 V':        'Sony_Xperia_1_V',
  'Nothing Phone (2)':      'Nothing_Phone_(2)',
  'Huawei P60 Pro':         'Huawei_P60',
  'iPad Pro 12.9" (M2)':    'IPad_Pro',
  'iPad Pro 11"':           'IPad_Pro',
  'iPad Air M2':            'IPad_Air',
  'iPad Air (5th Gen)':     'IPad_Air_(5th_generation)',
  'Galaxy Tab S9 Ultra':    'Samsung_Galaxy_Tab_S9',
  'Galaxy Tab S9':          'Samsung_Galaxy_Tab_S9',
  'MacBook Air M3 13"':     'MacBook_Air',
  'MacBook Pro 14" M3 Pro': 'MacBook_Pro',
  'Dell XPS 13 Plus':       'Dell_XPS',
};

// ---- local product photos ----
const ASSETS_ROOT = path.join(__dirname, '../../phone-rental-frontend/assets');

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function photoFolder(folder, aliases = {}) {
  const dir = path.join(ASSETS_ROOT, folder);
  const urlFor = (file) => `/assets/${folder}/${encodeURIComponent(file)}`;
  const byName = new Map();

  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    console.warn(`  ↳ no photo folder at ${dir}`);
  }
  for (const file of files) {
    if (!/\.(jpe?g|png|webp|avif|gif)$/i.test(file)) continue;
    byName.set(slug(file.replace(/\.[^.]+$/, '')), urlFor(file));
  }

  return {
    size: byName.size,
    lookup(name) {
      const alias = aliases[name];
      if (alias) {
        if (fs.existsSync(path.join(dir, alias))) return urlFor(alias);
        console.warn(`  ↳ alias for ${name} names a missing file: ${alias}`);
      }
      return byName.get(slug(name)) || null;
    },
  };
}

const SQUARE_PHOTOS = photoFolder('products', {
  'MacBook Air M3 13"': 'Apple MacBook Air 13in M3.jpg',
});

const WIDE_PHOTOS = photoFolder('hero-slider');

function getJson(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'DiaLux-seed/1.0 (student project)',
        Accept: 'application/json',
      },
    }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('too many redirects'));
        return resolve(getJson(new URL(headers.location, url).toString(), redirects - 1));
      }
      if (statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${statusCode}`)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('bad JSON')); }
      });
    }).on('error', reject);
  });
}

async function imageFor(title) {
  const j = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  const thumb = j.thumbnail && j.thumbnail.source;
  if (thumb) return thumb.replace(/\/\d+px-([^/]+)$/, '/640px-$1');
  return (j.originalimage && j.originalimage.source) || null;
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('✗ MONGODB_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ connected to MongoDB');

  if (hasFlag('reset')) {
    const { deletedCount } = await Product.deleteMany({});
    console.log(`✓ removed ${deletedCount} existing product(s)`);
  }

  let created = 0;
  let updated = 0;
  let imaged = 0;
  let wide = 0;
  let missingPhoto = [];

  for (const item of CATALOG) {
    const existing = await Product.findOne({ name: item.name });

    const square = SQUARE_PHOTOS.lookup(item.name);
    if (square) {
      item.image = square;
      item.images = [square];
      imaged++;
    } else if (IMAGE_TITLES[item.name] && !(existing && existing.image)) {
      try {
        const url = await imageFor(IMAGE_TITLES[item.name]);
        if (url) { item.image = url; imaged++; }
        else missingPhoto.push(item.name);
      } catch (err) {
        console.warn(`  ↳ no image for ${item.name} (${err.message})`);
        missingPhoto.push(item.name);
      }
    } else if (!(existing && existing.image)) {
      missingPhoto.push(item.name);
    }

    const landscape = WIDE_PHOTOS.lookup(item.name);
    if (landscape) { item.cardImage = landscape; wide++; }

    if (existing) {
      Object.assign(existing, item, { active: true });
      await existing.save();
      updated++;
    } else {
      await Product.create({ ...item, active: true });
      created++;
    }
  }

  console.log(`✓ catalog seeded — ${created} created, ${updated} updated, ${imaged} with a photo, ${wide} with a wide card shot`);
  if (missingPhoto.length) {
    console.log(`  ↳ ${missingPhoto.length} without a photo: ${missingPhoto.join(', ')}`);
  }

  const adminEmail = getFlag('admin');
  if (adminEmail) {
    const user = await User.findOneAndUpdate(
      { email: adminEmail.toLowerCase().trim() },
      { $set: { role: 'admin' } },
      { returnDocument: 'after' }
    );
    if (user) console.log(`✓ ${user.email} is now an administrator`);
    else console.error(`✗ no user found with email ${adminEmail} — register that account first, then re-run`);
  }

  for (const role of ['rider', 'technician']) {
    const email = getFlag(role);
    if (!email) continue;
    const user = await User.findOneAndUpdate(
      { email: email.toLowerCase().trim() },
      { $set: { role } },
      { returnDocument: 'after' }
    );
    if (user) console.log(`✓ ${user.email} is now a ${role}`);
    else console.error(`✗ no user found with email ${email} — register that account first, then re-run`);
  }

  const total = await Product.countDocuments({ active: true });
  console.log(`✓ done — ${total} active product(s) in the catalog`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('✗ seed failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});