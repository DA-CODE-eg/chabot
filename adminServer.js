const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { ensureDataFile, loadConfig, saveConfig } = require("./configStore");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || null;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "change-this-secret";
const ADMIN_PORT = Number(process.env.ADMIN_PORT || process.env.PORT || 3000);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 100);

const UPLOAD_DIRS = {
  video: path.join(__dirname, "videos"),
  manual: path.join(__dirname, "manuales"),
  image: path.join(__dirname, "imagenes")
};

const ALLOWED_EXTENSIONS = {
  video: [".mp4", ".mov", ".webm"],
  manual: [".pdf"],
  image: [".jpg", ".jpeg", ".png", ".gif", ".webp"]
};

function ensureUploadDirs() {
  Object.values(UPLOAD_DIRS).forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

function getPasswordHash() {
  if (ADMIN_PASSWORD_HASH) {
    return ADMIN_PASSWORD_HASH;
  }
  if (ADMIN_PASSWORD) {
    console.warn("⚠️ ADMIN_PASSWORD_HASH no configurado. Usando hash temporal de ADMIN_PASSWORD.");
    return bcrypt.hashSync(ADMIN_PASSWORD, 10);
  }
  return null;
}

function requireAuth(req, res, next) {
  if (req.session?.authenticated) {
    return next();
  }
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "No autorizado" });
  }
  return res.redirect("/admin/login");
}

function validateUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch (error) {
    return false;
  }
}

function safeUnlink(filePath) {
  if (!filePath) {
    return;
  }
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function updateResource(product, resourceKey, update) {
  const current = product[resourceKey] || { type: "none", path: null, url: null };
  product[resourceKey] = {
    type: update.type,
    path: update.path || null,
    url: update.url || null,
    updatedAt: new Date().toISOString()
  };
  return current;
}

function startAdminServer() {
  ensureDataFile();
  ensureUploadDirs();

  const app = express();

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: ADMIN_SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax"
      }
    })
  );

  const loginPath = path.join(__dirname, "admin", "login.html");
  const panelPath = path.join(__dirname, "admin", "panel.html");

  app.get("/admin/login", (req, res) => {
    res.sendFile(loginPath);
  });

  app.post("/admin/login", async (req, res) => {
    const passwordHash = getPasswordHash();
    const { username, password } = req.body || {};

    if (!passwordHash || !ADMIN_USER) {
      return res.status(500).send("Credenciales de admin no configuradas.");
    }

    const validUser = username === ADMIN_USER;
    const validPassword = await bcrypt.compare(password || "", passwordHash);

    if (!validUser || !validPassword) {
      return res.redirect("/admin/login?error=1");
    }

    req.session.authenticated = true;
    req.session.username = ADMIN_USER;
    return res.redirect("/admin");
  });

  app.post("/admin/logout", requireAuth, (req, res) => {
    req.session.destroy(() => {
      res.redirect("/admin/login");
    });
  });

  app.get("/admin", requireAuth, (req, res) => {
    res.sendFile(panelPath);
  });

  const apiRouter = express.Router();
  apiRouter.use(requireAuth);

  apiRouter.get("/products", (req, res) => {
    res.json(loadConfig());
  });

  apiRouter.post("/products/:id", (req, res) => {
    const { id } = req.params;
    const { label, manualName } = req.body || {};
    const config = loadConfig();
    const product = config.products.find((item) => item.id === id);

    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    if (typeof label === "string" && label.trim()) {
      product.label = label.trim();
    }
    if (typeof manualName === "string") {
      product.manualName = manualName.trim();
    }

    saveConfig(config);
    return res.json(product);
  });

  apiRouter.post("/products/:id/resource/:resource/url", (req, res) => {
    const { id, resource } = req.params;
    const { url } = req.body || {};

    if (!ALLOWED_EXTENSIONS[resource]) {
      return res.status(400).json({ error: "Recurso no permitido" });
    }

    if (!validateUrl(url)) {
      return res.status(400).json({ error: "URL inválida" });
    }

    const config = loadConfig();
    const product = config.products.find((item) => item.id === id);
    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    const previous = updateResource(product, resource, { type: "url", url });
    if (previous.type === "file" && previous.path) {
      safeUnlink(path.join(__dirname, previous.path));
    }

    saveConfig(config);
    return res.json(product[resource]);
  });

  apiRouter.post("/products/:id/resource/:resource/clear", (req, res) => {
    const { id, resource } = req.params;
    if (!ALLOWED_EXTENSIONS[resource]) {
      return res.status(400).json({ error: "Recurso no permitido" });
    }

    const config = loadConfig();
    const product = config.products.find((item) => item.id === id);
    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    const previous = updateResource(product, resource, { type: "none" });
    if (previous.type === "file" && previous.path) {
      safeUnlink(path.join(__dirname, previous.path));
    }

    saveConfig(config);
    return res.json(product[resource]);
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = UPLOAD_DIRS[req.params.resource];
        if (!dir) {
          return cb(new Error("Destino inválido"));
        }
        return cb(null, dir);
      },
      filename: (req, file, cb) => {
        const extension = path.extname(file.originalname).toLowerCase();
        const safeName = `${req.params.id}-${req.params.resource}-${Date.now()}${extension}`;
        cb(null, safeName);
      }
    }),
    limits: {
      fileSize: MAX_UPLOAD_MB * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
      const resource = req.params.resource;
      const extension = path.extname(file.originalname).toLowerCase();
      const allowed = ALLOWED_EXTENSIONS[resource] || [];
      if (!allowed.includes(extension)) {
        return cb(new Error("Tipo de archivo no permitido"));
      }
      return cb(null, true);
    }
  });

  apiRouter.post(
    "/products/:id/resource/:resource/file",
    upload.single("file"),
    (req, res) => {
      const { id, resource } = req.params;
      if (!req.file) {
        return res.status(400).json({ error: "Archivo requerido" });
      }

      const config = loadConfig();
      const product = config.products.find((item) => item.id === id);
      if (!product) {
        safeUnlink(req.file.path);
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      const relativePath = path
        .relative(__dirname, req.file.path)
        .split(path.sep)
        .join("/");

      const previous = updateResource(product, resource, {
        type: "file",
        path: relativePath
      });
      if (previous.type === "file" && previous.path && previous.path !== relativePath) {
        safeUnlink(path.join(__dirname, previous.path));
      }

      saveConfig(config);
      return res.json(product[resource]);
    }
  );

  app.use("/admin/api", apiRouter);

  app.use((err, req, res, next) => {
    if (!err) {
      return next();
    }
    console.error("Admin error:", err.message);
    if (req.path.startsWith("/admin/api")) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(400).send("Error procesando la solicitud.");
  });

  app.listen(ADMIN_PORT, () => {
    console.log(`🛠️ Panel admin activo en http://localhost:${ADMIN_PORT}/admin`);
  });
}

module.exports = { startAdminServer };
