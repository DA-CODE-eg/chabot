const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "products.json");
const BACKUP_FILE = path.join(DATA_DIR, "products.json.bak");

const DEFAULT_CONFIG = {
  products: [
    {
      id: "correo",
      label: "Correo Electrónico Certificado",
      manualName: "Manual Correo Electrónico Certificado",
      video: { type: "file", path: "videos/video_correo.mp4", url: null, updatedAt: null },
      manual: { type: "file", path: "manuales/manual_correo.pdf", url: null, updatedAt: null },
      image: { type: "none", path: null, url: null, updatedAt: null }
    },
    {
      id: "firma_electronica",
      label: "Firma Electrónica Certificada",
      manualName: "Manual Firma Electrónica Certificada",
      video: { type: "file", path: "videos/video_firma_electronica.mp4", url: null, updatedAt: null },
      manual: { type: "file", path: "manuales/manual_firma_electronica.pdf", url: null, updatedAt: null },
      image: { type: "none", path: null, url: null, updatedAt: null }
    },
    {
      id: "firma_digital",
      label: "Firma Digital",
      manualName: "Manual Firma Digital",
      video: { type: "file", path: "videos/video_firma_digital.mp4", url: null, updatedAt: null },
      manual: { type: "file", path: "manuales/manual_firma_digital.pdf", url: null, updatedAt: null },
      image: { type: "none", path: null, url: null, updatedAt: null }
    },
    {
      id: "tools",
      label: "App Tools",
      manualName: "Manual App Tools",
      video: { type: "file", path: "videos/Tools.mp4", url: null, updatedAt: null },
      manual: { type: "file", path: "manuales/manual_Tools.pdf", url: null, updatedAt: null },
      image: { type: "none", path: null, url: null, updatedAt: null }
    },
    {
      id: "firma_plus",
      label: "Firma Electrónica (Firma Plus)",
      manualName: "Manual Firma Electrónica (Firma Plus)",
      video: { type: "file", path: "videos/Firma_Plus.mp4", url: null, updatedAt: null },
      manual: { type: "file", path: "manuales/Firma_Plus.pdf", url: null, updatedAt: null },
      image: { type: "none", path: null, url: null, updatedAt: null }
    }
  ]
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

function loadConfig() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

function saveConfig(config) {
  ensureDataFile();
  if (fs.existsSync(DATA_FILE)) {
    fs.copyFileSync(DATA_FILE, BACKUP_FILE);
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 2));
  return config;
}

module.exports = {
  DEFAULT_CONFIG,
  DATA_FILE,
  BACKUP_FILE,
  ensureDataFile,
  loadConfig,
  saveConfig
};
