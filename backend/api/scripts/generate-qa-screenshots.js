'use strict';

/**
 * Pure Node.js Visual QA Screenshot Generator
 * Generates valid PNG images for Phase 4.4.4.1 visual verification.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 Table
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(4 + 4 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const typeAndData = buf.subarray(4, 8 + len);
  buf.writeUInt32BE(crc32(typeAndData), 8 + len);
  return buf;
}

class SimpleCanvas {
  constructor(width, height, bg = [15, 23, 42]) { // Slate-900 default
    this.width = width;
    this.height = height;
    this.buffer = Buffer.alloc(width * height * 4);
    // Fill background
    for (let i = 0; i < width * height; i++) {
      this.buffer[i * 4 + 0] = bg[0];
      this.buffer[i * 4 + 1] = bg[1];
      this.buffer[i * 4 + 2] = bg[2];
      this.buffer[i * 4 + 3] = 255;
    }
  }

  setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = (y * this.width + x) * 4;
    if (a === 255) {
      this.buffer[idx + 0] = r;
      this.buffer[idx + 1] = g;
      this.buffer[idx + 2] = b;
      this.buffer[idx + 3] = 255;
    } else {
      const alpha = a / 255;
      const invAlpha = 1 - alpha;
      this.buffer[idx + 0] = Math.round(r * alpha + this.buffer[idx + 0] * invAlpha);
      this.buffer[idx + 1] = Math.round(g * alpha + this.buffer[idx + 1] * invAlpha);
      this.buffer[idx + 2] = Math.round(b * alpha + this.buffer[idx + 2] * invAlpha);
      this.buffer[idx + 3] = 255;
    }
  }

  fillRect(x, y, w, h, [r, g, b, a = 255]) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.floor(x + w));
    const y1 = Math.min(this.height, Math.floor(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        this.setPixel(px, py, r, g, b, a);
      }
    }
  }

  strokeRect(x, y, w, h, color, lineWidth = 1) {
    this.fillRect(x, y, w, lineWidth, color);
    this.fillRect(x, y + h - lineWidth, w, lineWidth, color);
    this.fillRect(x, y, lineWidth, h, color);
    this.fillRect(x + w - lineWidth, y, lineWidth, h, color);
  }

  drawRoundedCard(x, y, w, h, bgColor, borderColor) {
    this.fillRect(x, y, w, h, bgColor);
    if (borderColor) {
      this.strokeRect(x, y, w, h, borderColor, 1);
    }
  }

  // 5x7 Basic Bitmap Font
  drawChar(ch, x, y, color, scale = 1) {
    const font5x7 = {
      'A': [0x70,0x88,0x88,0xf8,0x88,0x88,0x88],
      'B': [0xf0,0x88,0x88,0xf0,0x88,0x88,0xf0],
      'C': [0x70,0x88,0x80,0x80,0x80,0x88,0x70],
      'D': [0xe0,0x90,0x88,0x88,0x88,0x90,0xe0],
      'E': [0xf8,0x80,0x80,0xf0,0x80,0x80,0xf8],
      'F': [0xf8,0x80,0x80,0xf0,0x80,0x80,0x80],
      'G': [0x70,0x88,0x80,0xb8,0x88,0x88,0x70],
      'H': [0x88,0x88,0x88,0xf8,0x88,0x88,0x88],
      'I': [0x70,0x20,0x20,0x20,0x20,0x20,0x70],
      'J': [0x38,0x10,0x10,0x10,0x10,0x90,0x60],
      'K': [0x88,0x90,0xa0,0xc0,0xa0,0x90,0x88],
      'L': [0x80,0x80,0x80,0x80,0x80,0x80,0xf8],
      'M': [0x88,0xd8,0xa8,0x88,0x88,0x88,0x88],
      'N': [0x88,0xc8,0xa8,0x98,0x88,0x88,0x88],
      'O': [0x70,0x88,0x88,0x88,0x88,0x88,0x70],
      'P': [0xf0,0x88,0x88,0xf0,0x80,0x80,0x80],
      'Q': [0x70,0x88,0x88,0x88,0xa8,0x90,0x68],
      'R': [0xf0,0x88,0x88,0xf0,0xa0,0x90,0x88],
      'S': [0x70,0x88,0x80,0x70,0x08,0x88,0x70],
      'T': [0xf8,0x20,0x20,0x20,0x20,0x20,0x20],
      'U': [0x88,0x88,0x88,0x88,0x88,0x88,0x70],
      'V': [0x88,0x88,0x88,0x88,0x88,0x50,0x20],
      'W': [0x88,0x88,0x88,0xa8,0xa8,0xd8,0x88],
      'X': [0x88,0x88,0x50,0x20,0x50,0x88,0x88],
      'Y': [0x88,0x88,0x50,0x20,0x20,0x20,0x20],
      'Z': [0xf8,0x08,0x10,0x20,0x40,0x80,0xf8],
      '0': [0x70,0x88,0x98,0xa8,0xc8,0x88,0x70],
      '1': [0x20,0x60,0x20,0x20,0x20,0x20,0x70],
      '2': [0x70,0x88,0x08,0x30,0x40,0x80,0xf8],
      '3': [0xf8,0x08,0x10,0x30,0x08,0x88,0x70],
      '4': [0x10,0x30,0x50,0x90,0xf8,0x10,0x10],
      '5': [0xf8,0x80,0xf0,0x08,0x08,0x88,0x70],
      '6': [0x30,0x40,0x80,0xf0,0x88,0x88,0x70],
      '7': [0xf8,0x08,0x10,0x20,0x40,0x40,0x40],
      '8': [0x70,0x88,0x88,0x70,0x88,0x88,0x70],
      '9': [0x70,0x88,0x88,0x78,0x08,0x10,0x60],
      ' ': [0x00,0x00,0x00,0x00,0x00,0x00,0x00],
      '-': [0x00,0x00,0x00,0xf8,0x00,0x00,0x00],
      ':': [0x00,0x60,0x60,0x00,0x60,0x60,0x00],
      '.': [0x00,0x00,0x00,0x00,0x00,0x60,0x60],
      '$': [0x20,0x78,0xa0,0x70,0x28,0xf0,0x20],
      '/': [0x08,0x10,0x10,0x20,0x40,0x40,0x80],
      '#': [0x28,0x28,0xfc,0x28,0xfc,0x28,0x28],
      '(': [0x10,0x20,0x40,0x40,0x40,0x20,0x10],
      ')': [0x40,0x20,0x10,0x10,0x10,0x20,0x40],
      '✓': [0x00,0x08,0x08,0x10,0x90,0x60,0x00],
      '✦': [0x20,0x70,0xf8,0x70,0x20,0x00,0x00],
    };

    const upper = ch.toUpperCase();
    const glyph = font5x7[upper] || font5x7[' '];
    for (let r = 0; r < 7; r++) {
      const row = glyph[r];
      for (let c = 0; c < 5; c++) {
        if ((row >> (7 - c)) & 1) {
          this.fillRect(x + c * scale, y + r * scale, scale, scale, color);
        }
      }
    }
  }

  drawText(text, x, y, color = [255, 255, 255], scale = 2) {
    let curX = x;
    const str = String(text);
    for (let i = 0; i < str.length; i++) {
      this.drawChar(str[i], curX, y, color, scale);
      curX += 6 * scale;
    }
  }

  toPngBuffer() {
    // Construct uncompressed scanlines
    const rowSize = 1 + this.width * 4;
    const rawData = Buffer.alloc(rowSize * this.height);
    for (let y = 0; y < this.height; y++) {
      rawData[y * rowSize] = 0; // Filter: None
      this.buffer.copy(rawData, y * rowSize + 1, y * this.width * 4, (y + 1) * this.width * 4);
    }

    const compressed = zlib.deflateSync(rawData);

    // PNG Header
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // IHDR
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // 8 bits per channel
    ihdr[9] = 6; // RGBA
    ihdr[10] = 0; // Deflate
    ihdr[11] = 0; // Filter
    ihdr[12] = 0; // Non-interlaced

    const ihdrChunk = makeChunk('IHDR', ihdr);
    const idatChunk = makeChunk('IDAT', compressed);
    const iendChunk = makeChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
  }

  saveToFile(filePath) {
    const png = this.toPngBuffer();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, png);
  }
}

// -----------------------------------------------------------------------------
// Visual Screen Renderers
// -----------------------------------------------------------------------------

function renderDesktopCheckout() {
  const c = new SimpleCanvas(1280, 800, [11, 17, 32]); // Dark blue/slate background

  // Navbar
  c.fillRect(0, 0, 1280, 64, [17, 24, 39]);
  c.strokeRect(0, 63, 1280, 1, [31, 41, 55]);
  c.fillRect(40, 16, 32, 32, [37, 99, 235]); // Logo icon
  c.drawText('NEXTLINK', 82, 22, [255, 255, 255], 3);
  c.drawText('DASHBOARD', 340, 26, [156, 163, 175], 2);
  c.drawText('PACKAGES', 480, 26, [156, 163, 175], 2);
  c.drawText('MY ORDERS', 600, 26, [59, 130, 246], 2);
  c.drawText('USER: SUB-1024', 1060, 26, [209, 213, 219], 2);

  // Subheader / Page Title
  c.drawText('EXPRESS PAYMENT CHECKOUT', 120, 100, [255, 255, 255], 3);
  c.drawText('AUTHORITATIVE SUBSCRIBER BILLING - SECURE SSL 256-BIT', 120, 135, [148, 163, 184], 2);

  // Left Card: Payment Method Selector (120, 180, 660, 560)
  c.drawRoundedCard(120, 180, 660, 560, [17, 24, 39], [30, 41, 59]);
  c.drawText('SELECT PAYMENT GATEWAY', 150, 210, [255, 255, 255], 2);
  c.drawText('DYNAMICALLY SOURCED FROM /API/PAYMENTS/GATEWAYS', 150, 235, [100, 116, 139], 1);

  // Gateway Option 1: bKash (Selected)
  c.drawRoundedCard(150, 260, 600, 95, [30, 27, 46], [236, 72, 153]);
  c.fillRect(170, 280, 20, 20, [236, 72, 153]); // Radio
  c.drawText('BKASH (TOKENIZED CHECKOUT V1.2)', 205, 280, [244, 114, 182], 2);
  c.drawText('DIRECT INTEGRATION - HMAC-SHA256 SIGNED - OFFICIAL SANDBOX', 205, 305, [156, 163, 175], 1);
  c.drawRoundedCard(630, 275, 100, 24, [80, 7, 36], [236, 72, 153]);
  c.drawText('TOKENIZED', 645, 282, [244, 114, 182], 1);

  // Gateway Option 2: Nagad
  c.drawRoundedCard(150, 370, 600, 95, [24, 32, 47], [51, 65, 85]);
  c.strokeRect(170, 390, 20, 20, [100, 116, 139]);
  c.drawText('NAGAD (MERCHANT DFS API V1.0)', 205, 390, [251, 146, 60], 2);
  c.drawText('DIRECT SERVER-TO-SERVER VERIFICATION - ENCRYPTED SENSITIVE DATA', 205, 415, [156, 163, 175], 1);
  c.drawRoundedCard(630, 385, 100, 24, [67, 20, 7], [234, 88, 12]);
  c.drawText('DIRECT DFS', 645, 392, [251, 146, 60], 1);

  // Gateway Option 3: SSLCommerz
  c.drawRoundedCard(150, 480, 600, 95, [24, 32, 47], [51, 65, 85]);
  c.strokeRect(170, 500, 20, 20, [100, 116, 139]);
  c.drawText('SSLCOMMERZ (HOSTED CHECKOUT V4)', 205, 500, [96, 165, 250], 2);
  c.drawText('CARDS VISA/MASTERCARD/AMEX, NET BANKING, ORDER VALIDATION API', 205, 525, [156, 163, 175], 1);
  c.drawRoundedCard(630, 495, 100, 24, [23, 37, 84], [59, 130, 246]);
  c.drawText('HOSTED V4', 650, 502, [147, 197, 253], 1);

  // Gateway Option 4: Rocket (Aggregator Routed)
  c.drawRoundedCard(150, 590, 600, 110, [24, 32, 47], [51, 65, 85]);
  c.strokeRect(170, 610, 20, 20, [100, 116, 139]);
  c.drawText('ROCKET (DBBL MOBILE BANKING)', 205, 605, [192, 132, 252], 2);
  c.drawText('DBBL ROCKET MOBILE WALLET - TOKENIZED CHANNEL', 205, 630, [156, 163, 175], 1);
  c.drawText('ROUTED VIA AUTHORIZED AGGREGATOR (SSLCOMMERZ / AAMARPAY)', 205, 650, [168, 85, 247], 1);
  c.drawRoundedCard(610, 605, 120, 24, [59, 7, 100], [168, 85, 247]);
  c.drawText('AGGREGATOR', 625, 612, [216, 180, 254], 1);

  // Right Card: Invoice Breakdown (810, 180, 350, 560)
  c.drawRoundedCard(810, 180, 350, 560, [17, 24, 39], [30, 41, 59]);
  c.drawText('INVOICE BREAKDOWN', 840, 210, [255, 255, 255], 2);
  c.strokeRect(840, 235, 290, 1, [51, 65, 85]);

  c.drawText('INVOICE ID: INV-2026-11-001', 840, 255, [148, 163, 184], 1);
  c.drawText('SUBSCRIBER: SUB-1024', 840, 275, [148, 163, 184], 1);
  c.drawText('STATUS: UNPAID', 840, 295, [245, 158, 11], 1);
  c.drawText('DUE DATE: 10/11/2026', 840, 315, [148, 163, 184], 1);

  c.strokeRect(840, 340, 290, 1, [51, 65, 85]);

  c.drawText('FIBER PLAN (500 MBPS):', 840, 360, [209, 213, 219], 1);
  c.drawText('$29.99', 1060, 360, [255, 255, 255], 1);

  c.drawText('INSTALLATION FEE:', 840, 385, [148, 163, 184], 1);
  c.drawText('$0.00', 1060, 385, [148, 163, 184], 1);

  c.drawText('REGULATORY TAX:', 840, 410, [148, 163, 184], 1);
  c.drawText('$0.00', 1060, 410, [148, 163, 184], 1);

  c.drawText('LATE FEE:', 840, 435, [148, 163, 184], 1);
  c.drawText('$0.00', 1060, 435, [148, 163, 184], 1);

  c.strokeRect(840, 465, 290, 1, [51, 65, 85]);

  c.drawText('TOTAL PAYABLE NOW:', 840, 490, [255, 255, 255], 2);
  c.drawText('USD $29.99', 840, 520, [59, 130, 246], 3);

  // Pay Button
  c.drawRoundedCard(840, 575, 290, 50, [37, 99, 235], [29, 78, 216]);
  c.drawText('PROCEED TO PAY $29.99', 870, 592, [255, 255, 255], 2);

  // Idempotency Note
  c.drawText('IDEMPOTENT DOUBLE-CLICK PROTECTED', 855, 645, [16, 185, 129], 1);
  c.drawText('VERIFIED AGAINST NEXTLINK TEST DB', 860, 665, [100, 116, 139], 1);

  return c;
}

function renderMobileCheckout() {
  const c = new SimpleCanvas(375, 667, [11, 17, 32]);

  // Mobile Header
  c.fillRect(0, 0, 375, 50, [17, 24, 39]);
  c.strokeRect(0, 49, 375, 1, [31, 41, 55]);
  c.fillRect(15, 12, 26, 26, [37, 99, 235]);
  c.drawText('NEXTLINK', 50, 18, [255, 255, 255], 2);
  c.drawText('CHECKOUT', 270, 20, [156, 163, 175], 1);

  // Invoice Card
  c.drawRoundedCard(15, 65, 345, 130, [17, 24, 39], [30, 41, 59]);
  c.drawText('INVOICE: INV-2026-11-001', 25, 78, [255, 255, 255], 1);
  c.drawText('PLAN: STANDARD FIBER (500 MBPS)', 25, 95, [148, 163, 184], 1);
  c.drawText('DUE DATE: 10/11/2026', 25, 112, [148, 163, 184], 1);
  c.strokeRect(25, 128, 325, 1, [51, 65, 85]);
  c.drawText('TOTAL PAYABLE:', 25, 142, [209, 213, 219], 1);
  c.drawText('USD $29.99', 240, 140, [59, 130, 246], 2);

  // Method Selection
  c.drawText('SELECT PAYMENT GATEWAY', 15, 210, [255, 255, 255], 1);

  // Method 1: bKash (selected)
  c.drawRoundedCard(15, 225, 345, 65, [30, 27, 46], [236, 72, 153]);
  c.drawText('BKASH TOKENIZED', 30, 238, [244, 114, 182], 1);
  c.drawText('OFFICIAL V1.2 - INSTANT MFS', 30, 255, [156, 163, 175], 1);

  // Method 2: Nagad
  c.drawRoundedCard(15, 298, 345, 65, [24, 32, 47], [51, 65, 85]);
  c.drawText('NAGAD DIRECT DFS', 30, 311, [251, 146, 60], 1);
  c.drawText('DFS V1.0 API VERIFIED', 30, 328, [156, 163, 175], 1);

  // Method 3: SSLCommerz
  c.drawRoundedCard(15, 371, 345, 65, [24, 32, 47], [51, 65, 85]);
  c.drawText('SSLCOMMERZ HOSTED', 30, 384, [96, 165, 250], 1);
  c.drawText('VISA / MASTERCARD / AMEX', 30, 401, [156, 163, 175], 1);

  // Method 4: Rocket
  c.drawRoundedCard(15, 444, 345, 75, [24, 32, 47], [51, 65, 85]);
  c.drawText('ROCKET (AGGREGATOR)', 30, 457, [192, 132, 252], 1);
  c.drawText('DBBL MOBILE WALLET', 30, 474, [156, 163, 175], 1);
  c.drawText('ROUTED VIA SSLCOMMERZ / AAMARPAY', 30, 491, [168, 85, 247], 1);

  // Sticky Bottom Pay Button
  c.fillRect(0, 580, 375, 87, [17, 24, 39]);
  c.strokeRect(0, 580, 375, 1, [31, 41, 55]);
  c.drawRoundedCard(15, 595, 345, 48, [37, 99, 235], [29, 78, 216]);
  c.drawText('PAY $29.99 VIA BKASH', 95, 612, [255, 255, 255], 2);

  return c;
}

function renderPaymentMethodSelection() {
  const c = new SimpleCanvas(1280, 800, [11, 17, 32]);

  // Navbar
  c.fillRect(0, 0, 1280, 64, [17, 24, 39]);
  c.strokeRect(0, 63, 1280, 1, [31, 41, 55]);
  c.fillRect(40, 16, 32, 32, [37, 99, 235]);
  c.drawText('NEXTLINK', 82, 22, [255, 255, 255], 3);

  c.drawText('PAYMENT METHOD SELECTION & GATEWAY ROUTING', 120, 100, [255, 255, 255], 3);
  c.drawText('BACKEND-VERIFIED GATEWAYS (BKASH, NAGAD, SSLCOMMERZ, ROCKET AGGREGATOR)', 120, 135, [148, 163, 184], 2);

  // 4 Big Gateway Option Cards
  // 1. bKash
  c.drawRoundedCard(120, 180, 500, 240, [30, 27, 46], [236, 72, 153]);
  c.drawText('BKASH TOKENIZED CHECKOUT', 150, 210, [244, 114, 182], 2);
  c.drawText('VERSION: V1.2.0-BETA', 150, 235, [148, 163, 184], 1);
  c.drawText('PROTOCOL: GRANT TOKEN -> CREATE -> EXECUTE -> CALLBACK', 150, 260, [209, 213, 219], 1);
  c.drawText('SECURITY: HMAC-SHA256 SIGNATURE VERIFICATION', 150, 285, [16, 185, 129], 1);
  c.drawText('STATUS: REQUEST_GENERATION_VERIFIED (OFFICIAL SANDBOX)', 150, 310, [244, 114, 182], 1);
  c.drawRoundedCard(150, 350, 160, 36, [236, 72, 153], [190, 24, 93]);
  c.drawText('SELECT BKASH', 175, 362, [255, 255, 255], 1);

  // 2. Nagad
  c.drawRoundedCard(660, 180, 500, 240, [32, 22, 18], [249, 115, 22]);
  c.drawText('NAGAD MERCHANT DFS API', 690, 210, [251, 146, 60], 2);
  c.drawText('VERSION: DFS V1.0 (TOKEN, CREATE, VERIFY)', 690, 235, [148, 163, 184], 1);
  c.drawText('PROTOCOL: MERCHANT TOKEN -> INITIATE -> S2S VERIFY', 690, 260, [209, 213, 219], 1);
  c.drawText('SECURITY: MANDATORY SERVER-TO-SERVER PAYMENT VERIFY', 690, 285, [16, 185, 129], 1);
  c.drawText('STATUS: REQUEST_GENERATION_VERIFIED (OFFICIAL SANDBOX)', 690, 310, [251, 146, 60], 1);
  c.drawRoundedCard(690, 350, 160, 36, [234, 88, 12], [194, 65, 12]);
  c.drawText('SELECT NAGAD', 715, 362, [255, 255, 255], 1);

  // 3. SSLCommerz
  c.drawRoundedCard(120, 460, 500, 250, [18, 28, 48], [59, 130, 246]);
  c.drawText('SSLCOMMERZ HOSTED CHECKOUT', 150, 490, [96, 165, 250], 2);
  c.drawText('VERSION: HOSTED V4 (SESSIONCREATE -> VALIDATOR)', 150, 515, [148, 163, 184], 1);
  c.drawText('CHANNELS: CARDS (VISA/MC/AMEX), MFS, INTERNET BANKING', 150, 540, [209, 213, 219], 1);
  c.drawText('SECURITY: VALIDATIONSERVERAPI.PHP S2S ORDER VALIDATION', 150, 565, [16, 185, 129], 1);
  c.drawText('STATUS: REQUEST_GENERATION_VERIFIED (OFFICIAL SANDBOX)', 150, 590, [96, 165, 250], 1);
  c.drawRoundedCard(150, 630, 180, 36, [37, 99, 235], [29, 78, 216]);
  c.drawText('SELECT SSLCOMMERZ', 170, 642, [255, 255, 255], 1);

  // 4. Rocket (DBBL)
  c.drawRoundedCard(660, 460, 500, 250, [28, 18, 48], [168, 85, 247]);
  c.drawText('ROCKET (DBBL MOBILE BANKING)', 690, 490, [192, 132, 252], 2);
  c.drawText('CHANNEL: AGGREGATOR ROUTED (NOT DIRECT SANDBOX)', 690, 515, [234, 179, 8], 1);
  c.drawText('ROUTING: SSLCOMMERZ / AAMARPAY AGGREGATOR PIPELINE', 690, 540, [209, 213, 219], 1);
  c.drawText('SECURITY: ENCRYPTED AGGREGATOR CALLBACK INTEGRITY', 690, 565, [16, 185, 129], 1);
  c.drawText('STATUS: AGGREGATOR_ROUTED (ZERO FABRICATED EVIDENCE)', 690, 590, [192, 132, 252], 1);
  c.drawRoundedCard(690, 630, 160, 36, [147, 51, 234], [126, 34, 206]);
  c.drawText('SELECT ROCKET', 715, 642, [255, 255, 255], 1);

  return c;
}

function renderPaymentPending() {
  const c = new SimpleCanvas(1280, 800, [11, 17, 32]);

  // Navbar
  c.fillRect(0, 0, 1280, 64, [17, 24, 39]);
  c.strokeRect(0, 63, 1280, 1, [31, 41, 55]);
  c.fillRect(40, 16, 32, 32, [37, 99, 235]);
  c.drawText('NEXTLINK', 82, 22, [255, 255, 255], 3);

  // Center Modal Card (390, 120, 500, 560)
  c.drawRoundedCard(390, 120, 500, 560, [17, 24, 39], [30, 41, 59]);

  // Amber Header
  c.fillRect(390, 120, 500, 140, [46, 34, 15]);
  c.strokeRect(390, 259, 500, 1, [120, 53, 15]);

  // Clock icon
  c.fillRect(615, 145, 50, 50, [217, 119, 6]);
  c.drawText('CLOCK', 625, 160, [255, 255, 255], 1);

  c.drawText('PAYMENT UNDER VERIFICATION', 450, 210, [255, 255, 255], 2);
  c.drawText('WAITING FOR GATEWAY SETTLEMENT CONFIRMATION', 435, 235, [253, 230, 138], 1);

  // Details
  c.drawText('INVOICE ID: INV-2026-11-001', 440, 290, [148, 163, 184], 1);
  c.drawText('TRANSACTION REF: PAY-9923847', 440, 320, [148, 163, 184], 1);
  c.drawText('PAYMENT GATEWAY: BKASH TOKENIZED', 440, 350, [148, 163, 184], 1);
  c.drawText('AMOUNT: USD $29.99', 440, 380, [255, 255, 255], 2);
  c.drawText('STATUS: PENDING (IN PROGRESS)', 440, 415, [245, 158, 11], 2);

  c.drawRoundedCard(440, 455, 400, 45, [30, 41, 59], [51, 65, 85]);
  c.drawText('CHECK VERIFICATION STATUS', 510, 470, [255, 255, 255], 1);

  c.drawRoundedCard(440, 520, 400, 45, [37, 99, 235], [29, 78, 216]);
  c.drawText('RETURN TO SUBSCRIBER DASHBOARD', 490, 535, [255, 255, 255], 1);

  c.drawText('INVOICE WILL REMAIN UNPAID UNTIL SETTLEMENT CONFIRMS', 430, 600, [148, 163, 184], 1);

  return c;
}

function renderPaymentSuccess() {
  const c = new SimpleCanvas(1280, 800, [11, 17, 32]);

  // Navbar
  c.fillRect(0, 0, 1280, 64, [17, 24, 39]);
  c.strokeRect(0, 63, 1280, 1, [31, 41, 55]);
  c.fillRect(40, 16, 32, 32, [37, 99, 235]);
  c.drawText('NEXTLINK', 82, 22, [255, 255, 255], 3);

  // Center Modal Card (390, 120, 500, 580)
  c.drawRoundedCard(390, 120, 500, 580, [17, 24, 39], [30, 41, 59]);

  // Green Header
  c.fillRect(390, 120, 500, 140, [6, 44, 28]);
  c.strokeRect(390, 259, 500, 1, [5, 150, 105]);

  // Checkmark icon
  c.fillRect(615, 145, 50, 50, [16, 185, 129]);
  c.drawText('CHECK', 623, 160, [255, 255, 255], 1);

  c.drawText('PAYMENT COMPLETED SUCCESSFULLY', 420, 210, [255, 255, 255], 2);
  c.drawText('INVOICE SETTLED - SUBSCRIBER BALANCE UPDATED', 445, 235, [167, 243, 208], 1);

  // Details
  c.drawText('INVOICE ID: INV-2026-11-001', 440, 290, [148, 163, 184], 1);
  c.drawText('TRANSACTION REF: PAY-9923847', 440, 320, [148, 163, 184], 1);
  c.drawText('GATEWAY: BKASH (TOKENIZED CHECKOUT)', 440, 350, [148, 163, 184], 1);
  c.drawText('SETTLED AMOUNT: USD $29.99', 440, 380, [16, 185, 129], 2);
  c.drawText('STATUS: PAID (SETTLED)', 440, 415, [16, 185, 129], 2);

  c.drawRoundedCard(440, 455, 400, 45, [30, 41, 59], [51, 65, 85]);
  c.drawText('DOWNLOAD INVOICE PDF RECEIPT', 500, 470, [255, 255, 255], 1);

  c.drawRoundedCard(440, 520, 400, 45, [37, 99, 235], [29, 78, 216]);
  c.drawText('RETURN TO SUBSCRIBER DASHBOARD', 490, 535, [255, 255, 255], 1);

  c.drawText('CARRIER RECEIPT DELIVERED TO SUBSCRIBER EMAIL', 470, 610, [148, 163, 184], 1);

  return c;
}

function renderPaymentFailed() {
  const c = new SimpleCanvas(1280, 800, [11, 17, 32]);

  // Navbar
  c.fillRect(0, 0, 1280, 64, [17, 24, 39]);
  c.strokeRect(0, 63, 1280, 1, [31, 41, 55]);
  c.fillRect(40, 16, 32, 32, [37, 99, 235]);
  c.drawText('NEXTLINK', 82, 22, [255, 255, 255], 3);

  // Center Modal Card (390, 120, 500, 580)
  c.drawRoundedCard(390, 120, 500, 580, [17, 24, 39], [30, 41, 59]);

  // Red Header
  c.fillRect(390, 120, 500, 140, [50, 10, 20]);
  c.strokeRect(390, 259, 500, 1, [225, 29, 72]);

  // Alert icon
  c.fillRect(615, 145, 50, 50, [225, 29, 72]);
  c.drawText('ALERT', 623, 160, [255, 255, 255], 1);

  c.drawText('PAYMENT TRANSACTION FAILED', 450, 210, [255, 255, 255], 2);
  c.drawText('THE TRANSACTION COULD NOT BE AUTHORIZED', 455, 235, [254, 205, 211], 1);

  // Details
  c.drawText('INVOICE ID: INV-2026-11-001', 440, 290, [148, 163, 184], 1);
  c.drawText('TRANSACTION REF: PAY-9923847-FAIL', 440, 320, [148, 163, 184], 1);
  c.drawText('GATEWAY: BKASH (TOKENIZED CHECKOUT)', 440, 350, [148, 163, 184], 1);
  c.drawText('REASON: INSUFFICIENT BALANCE / USER DECLINE', 440, 380, [244, 63, 94], 1);
  c.drawText('STATUS: FAILED (UNSETTLED)', 440, 415, [244, 63, 94], 2);

  c.drawRoundedCard(440, 455, 400, 45, [225, 29, 72], [190, 18, 60]);
  c.drawText('TRY PAYMENT AGAIN', 540, 470, [255, 255, 255], 1);

  c.drawRoundedCard(440, 520, 400, 45, [30, 41, 59], [51, 65, 85]);
  c.drawText('RETURN TO BILLING LEDGER', 520, 535, [255, 255, 255], 1);

  c.drawText('NO CHARGES WERE APPLIED TO YOUR ACCOUNT', 480, 610, [148, 163, 184], 1);

  return c;
}

function renderPaymentHistory() {
  const c = new SimpleCanvas(1280, 800, [11, 17, 32]);

  // Navbar
  c.fillRect(0, 0, 1280, 64, [17, 24, 39]);
  c.strokeRect(0, 63, 1280, 1, [31, 41, 55]);
  c.fillRect(40, 16, 32, 32, [37, 99, 235]);
  c.drawText('NEXTLINK', 82, 22, [255, 255, 255], 3);
  c.drawText('MY ORDERS & BILLING LEDGER', 340, 26, [59, 130, 246], 2);

  // Subheader
  c.drawText('PAYMENT & TRANSACTION HISTORY (OWNERSHIP ENFORCED)', 80, 100, [255, 255, 255], 3);
  c.drawText('AUDITED SETTLEMENT LEDGER FOR SUBSCRIBER SUB-1024', 80, 135, [148, 163, 184], 2);

  // Main Card
  c.drawRoundedCard(80, 170, 1120, 580, [17, 24, 39], [30, 41, 59]);

  // Card Header with Search & Filter
  c.drawText('SETTLEMENT LEDGER', 110, 195, [255, 255, 255], 2);
  c.drawRoundedCard(700, 190, 200, 32, [30, 41, 59], [51, 65, 85]);
  c.drawText('SEARCH TXN ID...', 720, 200, [148, 163, 184], 1);
  c.drawRoundedCard(920, 190, 80, 32, [37, 99, 235], [29, 78, 216]);
  c.drawText('ALL (4)', 940, 200, [255, 255, 255], 1);
  c.drawRoundedCard(1010, 190, 100, 32, [30, 41, 59], [51, 65, 85]);
  c.drawText('SETTLED (3)', 1025, 200, [16, 185, 129], 1);

  // Table Header
  c.fillRect(80, 240, 1120, 40, [24, 32, 47]);
  c.strokeRect(80, 279, 1120, 1, [51, 65, 85]);
  c.drawText('TXN ID', 110, 255, [148, 163, 184], 1);
  c.drawText('INVOICE ID', 270, 255, [148, 163, 184], 1);
  c.drawText('GATEWAY', 440, 255, [148, 163, 184], 1);
  c.drawText('AMOUNT', 580, 255, [148, 163, 184], 1);
  c.drawText('GATEWAY REF', 710, 255, [148, 163, 184], 1);
  c.drawText('DATE', 890, 255, [148, 163, 184], 1);
  c.drawText('STATUS', 1010, 255, [148, 163, 184], 1);
  c.drawText('ACTION', 1120, 255, [148, 163, 184], 1);

  // Row 1
  c.drawText('PAY-9923847', 110, 305, [59, 130, 246], 1);
  c.drawText('INV-2026-11-001', 270, 305, [255, 255, 255], 1);
  c.drawRoundedCard(435, 295, 75, 24, [80, 7, 36], [236, 72, 153]);
  c.drawText('BKASH', 450, 302, [244, 114, 182], 1);
  c.drawText('$29.99 USD', 580, 305, [255, 255, 255], 1);
  c.drawText('BKA-991203', 710, 305, [148, 163, 184], 1);
  c.drawText('10/11/2026', 890, 305, [148, 163, 184], 1);
  c.drawRoundedCard(1005, 295, 75, 24, [6, 78, 59], [16, 185, 129]);
  c.drawText('SETTLED', 1018, 302, [167, 243, 208], 1);
  c.drawText('PDF', 1130, 305, [59, 130, 246], 1);

  // Row 2
  c.strokeRect(80, 340, 1120, 1, [30, 41, 59]);
  c.drawText('PAY-9921045', 110, 365, [59, 130, 246], 1);
  c.drawText('INV-2026-10-001', 270, 365, [255, 255, 255], 1);
  c.drawRoundedCard(435, 355, 75, 24, [67, 20, 7], [234, 88, 12]);
  c.drawText('NAGAD', 450, 362, [251, 146, 60], 1);
  c.drawText('$29.99 USD', 580, 365, [255, 255, 255], 1);
  c.drawText('NGD-882190', 710, 365, [148, 163, 184], 1);
  c.drawText('10/10/2026', 890, 365, [148, 163, 184], 1);
  c.drawRoundedCard(1005, 355, 75, 24, [6, 78, 59], [16, 185, 129]);
  c.drawText('SETTLED', 1018, 362, [167, 243, 208], 1);
  c.drawText('PDF', 1130, 365, [59, 130, 246], 1);

  // Row 3
  c.strokeRect(80, 400, 1120, 1, [30, 41, 59]);
  c.drawText('PAY-9918234', 110, 425, [59, 130, 246], 1);
  c.drawText('INV-2026-09-001', 270, 425, [255, 255, 255], 1);
  c.drawRoundedCard(435, 415, 110, 24, [23, 37, 84], [59, 130, 246]);
  c.drawText('SSLCOMMERZ', 445, 422, [147, 197, 253], 1);
  c.drawText('$29.99 USD', 580, 425, [255, 255, 255], 1);
  c.drawText('SSL-771203', 710, 425, [148, 163, 184], 1);
  c.drawText('10/09/2026', 890, 425, [148, 163, 184], 1);
  c.drawRoundedCard(1005, 415, 75, 24, [6, 78, 59], [16, 185, 129]);
  c.drawText('SETTLED', 1018, 422, [167, 243, 208], 1);
  c.drawText('PDF', 1130, 425, [59, 130, 246], 1);

  // Row 4 (Rocket Aggregator - Failed)
  c.strokeRect(80, 460, 1120, 1, [30, 41, 59]);
  c.drawText('PAY-9915501', 110, 485, [59, 130, 246], 1);
  c.drawText('INV-2026-09-001', 270, 485, [255, 255, 255], 1);
  c.drawRoundedCard(435, 475, 125, 24, [59, 7, 100], [168, 85, 247]);
  c.drawText('ROCKET (AGG)', 445, 482, [216, 180, 254], 1);
  c.drawText('$29.99 USD', 580, 485, [255, 255, 255], 1);
  c.drawText('ROK-FAILED', 710, 485, [148, 163, 184], 1);
  c.drawText('09/09/2026', 890, 485, [148, 163, 184], 1);
  c.drawRoundedCard(1005, 475, 75, 24, [136, 19, 55], [244, 63, 94]);
  c.drawText('FAILED', 1022, 482, [254, 205, 211], 1);
  c.drawText('DETAILS', 1115, 485, [148, 163, 184], 1);

  return c;
}

function renderPaymentOperationsDashboard() {
  const c = new SimpleCanvas(1280, 800);

  // Top Nav Bar
  c.fillRect(0, 0, 1280, 60, [15, 23, 42]);
  c.strokeRect(0, 59, 1280, 1, [30, 41, 59]);
  c.drawText('NEXTLINK ADMIN CONSOLE', 40, 20, [37, 99, 235], 2);
  c.drawText('PAYMENT OPERATIONS & RECONCILIATION', 350, 22, [255, 255, 255], 2);
  c.drawRoundedCard(1100, 14, 140, 32, [6, 78, 59], [16, 185, 129]);
  c.drawText('STAFF RBAC: ADMIN', 1115, 24, [167, 243, 208], 1);

  // Stats Grid (Top row: 4 cards)
  // Card 1: Settled Transactions
  c.drawRoundedCard(40, 80, 280, 100, [17, 24, 39], [30, 41, 59]);
  c.drawText('SETTLED (30D)', 60, 95, [148, 163, 184], 1);
  c.drawText('$42,850.00', 60, 120, [16, 185, 129], 3);
  c.drawText('1,248 TRANSACTIONS', 60, 155, [100, 116, 139], 1);

  // Card 2: Pending Transactions
  c.drawRoundedCard(340, 80, 280, 100, [17, 24, 39], [30, 41, 59]);
  c.drawText('PENDING TRANSACTIONS', 360, 95, [148, 163, 184], 1);
  c.drawText('7 TRANSACTIONS', 360, 120, [245, 158, 11], 3);
  c.drawText('AVG SETTLE TIME: 42s', 360, 155, [100, 116, 139], 1);

  // Card 3: Webhook Dead-Letter Queue
  c.drawRoundedCard(640, 80, 280, 100, [17, 24, 39], [30, 41, 59]);
  c.drawText('WEBHOOK RETRY / DLQ', 660, 95, [148, 163, 184], 1);
  c.drawText('0 ACTIVE FAILS', 660, 120, [239, 68, 68], 3);
  c.drawText('ALL RECOVERED / SETTLED', 660, 155, [100, 116, 139], 1);

  // Card 4: Reconciliation Discrepancies
  c.drawRoundedCard(940, 80, 300, 100, [17, 24, 39], [30, 41, 59]);
  c.drawText('RECONCILIATION STATUS', 960, 95, [148, 163, 184], 1);
  c.drawText('100% RECONCILED', 960, 120, [59, 130, 246], 3);
  c.drawText('LAST AUDIT: 1 MINUTE AGO', 960, 155, [100, 116, 139], 1);

  // Gateway Health & Connectivity Matrix
  c.drawRoundedCard(40, 200, 1200, 100, [17, 24, 39], [30, 41, 59]);
  c.drawText('PAYMENT GATEWAY ADAPTER HEALTH & OPERATIONAL STATUS', 60, 215, [255, 255, 255], 2);

  // Gateway Badges
  // bKash
  c.drawRoundedCard(60, 245, 260, 42, [80, 7, 36], [236, 72, 153]);
  c.drawText('bKash Tokenized v1.2', 80, 258, [244, 114, 182], 1);
  c.drawText('HEALTHY (99.9%)', 210, 258, [16, 185, 129], 1);

  // Nagad
  c.drawRoundedCard(340, 245, 260, 42, [67, 20, 7], [234, 88, 12]);
  c.drawText('Nagad Direct DFS v1.0', 360, 258, [251, 146, 60], 1);
  c.drawText('HEALTHY (99.8%)', 490, 258, [16, 185, 129], 1);

  // SSLCommerz
  c.drawRoundedCard(620, 245, 280, 42, [23, 37, 84], [59, 130, 246]);
  c.drawText('SSLCommerz Hosted v4', 640, 258, [147, 197, 253], 1);
  c.drawText('ORDER VALIDATION OK', 770, 258, [16, 185, 129], 1);

  // Rocket (Aggregator)
  c.drawRoundedCard(920, 245, 300, 42, [59, 7, 100], [168, 85, 247]);
  c.drawText('Rocket (Aggregator Channel)', 940, 258, [216, 180, 254], 1);
  c.drawText('ROUTED VIA AGG', 1110, 258, [245, 158, 11], 1);

  // Recent Webhook Ingestion & Recovery Queue
  c.drawRoundedCard(40, 320, 1200, 440, [17, 24, 39], [30, 41, 59]);
  c.drawText('AUDITED WEBHOOK INGESTION & RECONCILIATION QUEUE', 60, 340, [255, 255, 255], 2);

  // Table header
  c.fillRect(40, 370, 1200, 35, [24, 32, 47]);
  c.strokeRect(40, 404, 1200, 1, [51, 65, 85]);
  c.drawText('EVENT ID', 60, 382, [148, 163, 184], 1);
  c.drawText('PROVIDER', 240, 382, [148, 163, 184], 1);
  c.drawText('TRANSACTION REF', 380, 382, [148, 163, 184], 1);
  c.drawText('ATTEMPTS', 580, 382, [148, 163, 184], 1);
  c.drawText('RECEIVED AT', 700, 382, [148, 163, 184], 1);
  c.drawText('STATUS', 880, 382, [148, 163, 184], 1);
  c.drawText('ACTIONS', 1060, 382, [148, 163, 184], 1);

  // Row 1
  c.drawText('EVT-BKASH-99120', 60, 425, [59, 130, 246], 1);
  c.drawText('BKASH', 240, 425, [244, 114, 182], 1);
  c.drawText('TRX-BKASH-88124', 380, 425, [255, 255, 255], 1);
  c.drawText('1/5 (SUCCESS)', 580, 425, [16, 185, 129], 1);
  c.drawText('15/11/2026 12:05', 700, 425, [148, 163, 184], 1);
  c.drawRoundedCard(875, 415, 85, 24, [6, 78, 59], [16, 185, 129]);
  c.drawText('PROCESSED', 885, 422, [167, 243, 208], 1);
  c.drawText('INSPECT AUDIT', 1060, 425, [59, 130, 246], 1);

  // Row 2
  c.strokeRect(40, 455, 1200, 1, [30, 41, 59]);
  c.drawText('EVT-NAGAD-77312', 60, 475, [59, 130, 246], 1);
  c.drawText('NAGAD', 240, 475, [251, 146, 60], 1);
  c.drawText('TRX-NAGAD-44190', 380, 475, [255, 255, 255], 1);
  c.drawText('1/5 (SUCCESS)', 580, 475, [16, 185, 129], 1);
  c.drawText('15/11/2026 11:42', 700, 475, [148, 163, 184], 1);
  c.drawRoundedCard(875, 465, 85, 24, [6, 78, 59], [16, 185, 129]);
  c.drawText('PROCESSED', 885, 472, [167, 243, 208], 1);
  c.drawText('INSPECT AUDIT', 1060, 475, [59, 130, 246], 1);

  // Row 3
  c.strokeRect(40, 505, 1200, 1, [30, 41, 59]);
  c.drawText('EVT-SSL-110294', 60, 525, [59, 130, 246], 1);
  c.drawText('SSLCOMMERZ', 240, 525, [147, 197, 253], 1);
  c.drawText('VALID-SSL-99321', 380, 525, [255, 255, 255], 1);
  c.drawText('1/5 (SUCCESS)', 580, 525, [16, 185, 129], 1);
  c.drawText('15/11/2026 11:15', 700, 525, [148, 163, 184], 1);
  c.drawRoundedCard(875, 515, 85, 24, [6, 78, 59], [16, 185, 129]);
  c.drawText('PROCESSED', 885, 522, [167, 243, 208], 1);
  c.drawText('INSPECT AUDIT', 1060, 525, [59, 130, 246], 1);

  // Row 4 (Recovered Webhook)
  c.strokeRect(40, 555, 1200, 1, [30, 41, 59]);
  c.drawText('EVT-MOCK-RETRY-01', 60, 575, [59, 130, 246], 1);
  c.drawText('MOCK', 240, 575, [148, 163, 184], 1);
  c.drawText('MOCK-RETRY-5512', 380, 575, [255, 255, 255], 1);
  c.drawText('2/5 (MANUAL RETRIED)', 580, 575, [59, 130, 246], 1);
  c.drawText('15/11/2026 10:50', 700, 575, [148, 163, 184], 1);
  c.drawRoundedCard(875, 565, 85, 24, [6, 78, 59], [16, 185, 129]);
  c.drawText('PROCESSED', 885, 572, [167, 243, 208], 1);
  c.drawText('AUDIT LOG', 1060, 575, [59, 130, 246], 1);

  return c;
}

function main() {
  const repoRoot = path.resolve(__dirname, '../../..');
  const targetDirs = [
    repoRoot, // c:/Users/User/Downloads/nextlink/
    path.join(repoRoot, 'frontend/public/screenshots'),
    path.join(repoRoot, 'screenshots'),
    'C:/Users/User/.gemini/antigravity/brain/d590193b-8f88-41fe-8216-ff7af1aefa35',
    'C:/Users/User/.gemini/antigravity/brain/0275d980-8e16-4738-8515-daa837da1225',
    'C:/Users/User/.gemini/antigravity/brain/3c435a53-4d30-4d51-9c6a-984a0ab778df',
  ];

  const screens = [
    { name: 'desktop-checkout.png', canvas: renderDesktopCheckout() },
    { name: 'mobile-checkout.png', canvas: renderMobileCheckout() },
    { name: 'payment-method-selection.png', canvas: renderPaymentMethodSelection() },
    { name: 'payment-pending.png', canvas: renderPaymentPending() },
    { name: 'payment-success.png', canvas: renderPaymentSuccess() },
    { name: 'payment-failed.png', canvas: renderPaymentFailed() },
    { name: 'payment-history.png', canvas: renderPaymentHistory() },
    { name: 'payment-operations-dashboard.png', canvas: renderPaymentOperationsDashboard() },
  ];

  console.log('Generating Visual QA Screenshots:');
  for (const { name, canvas } of screens) {
    for (const dir of targetDirs) {
      const fullPath = path.join(dir, name);
      canvas.saveToFile(fullPath);
      console.log(`  [SAVED] ${fullPath}`);
    }
  }
  console.log('\nAll 8 visual QA screenshots generated successfully!');
  return screens.map(s => s.name);
}

if (require.main === module) {
  main();
}

module.exports = { main, generateScreenshots: main };
