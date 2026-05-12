const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const csrf = require("csurf");
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

const VALID_RESOURCES = new Set(["video", "manual", "image"]);

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

function requireAuth(req, res, next) {
  if (req.session?.authenticated) {
    return next();
  }
  if (req.originalUrl.startsWith("/admin/api")) {
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

function resolveResourcePath(filePath) {
  if (!filePath) {
    return null;
  }
  const resolvedPath = path.resolve(__dirname, filePath);
  const allowedRoots = Object.values(UPLOAD_DIRS).map((dir) => path.resolve(dir));
  const isAllowed = allowedRoots.some(
    (root) => resolvedPath === root || resolvedPath.startsWith(`${root}${path.sep}`)
  );
  return isAllowed ? resolvedPath : null;
}

function safeUnlink(filePath) {
  const resolved = resolveResourcePath(filePath);
  if (resolved && fs.existsSync(resolved)) {
    fs.unlinkSync(resolved);
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

function renderTemplate(filePath, csrfToken) {
  const template = fs.readFileSync(filePath, "utf8");
  return template.replace(/{{csrfToken}}/g, csrfToken);
}

async function startAdminServer() {
  ensureDataFile();
  ensureUploadDirs();

  if (ADMIN_SESSION_SECRET === "change-this-secret" && process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_SESSION_SECRET debe configurarse en producción.");
  }
  if (ADMIN_SESSION_SECRET === "change-this-secret" && process.env.NODE_ENV !== "production") {
    console.warn("⚠️ ADMIN_SESSION_SECRET no configurado, usando valor por defecto.");
  }

  const resolvedPasswordHash =
    ADMIN_PASSWORD_HASH ||
    (ADMIN_PASSWORD
      ? await bcrypt.hash(ADMIN_PASSWORD, 10)
      : null);

  if (!resolvedPasswordHash) {
    console.error("⚠️ Credenciales admin no configuradas. Configura ADMIN_PASSWORD_HASH.");
  }

  const app = express();

  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: ADMIN_SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production"
      }
    })
  );

  const csrfProtection = csrf();
  app.use("/admin", csrfProtection);

  const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: "draft-7",
    legacyHeaders: false
  });
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false
  });

  const loginPath = path.join(__dirname, "admin", "login.html");
  const panelPath = path.join(__dirname, "admin", "panel.html");

  app.get("/admin/login", (req, res) => {
    res.send(renderTemplate(loginPath, req.csrfToken()));
  });

  app.post("/admin/login", loginLimiter, async (req, res) => {
    const { username, password } = req.body || {};

    if (!resolvedPasswordHash || !ADMIN_USER) {
      console.error("Credenciales de admin no configuradas.");
      return res.status(401).send("Autenticación fallida.");
    }

    const validUser = username === ADMIN_USER;
    const validPassword = await bcrypt.compare(password || "", resolvedPasswordHash);

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
    res.send(renderTemplate(panelPath, req.csrfToken()));
  });

  const apiRouter = express.Router();
  apiRouter.use(adminLimiter, requireAuth);

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

    if (!VALID_RESOURCES.has(resource)) {
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
      safeUnlink(previous.path);
    }

    saveConfig(config);
    return res.json(product[resource]);
  });

  apiRouter.post("/products/:id/resource/:resource/clear", (req, res) => {
    const { id, resource } = req.params;
    if (!VALID_RESOURCES.has(resource)) {
      return res.status(400).json({ error: "Recurso no permitido" });
    }

    const config = loadConfig();
    const product = config.products.find((item) => item.id === id);
    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    const previous = updateResource(product, resource, { type: "none" });
    if (previous.type === "file" && previous.path) {
      safeUnlink(previous.path);
    }

    saveConfig(config);
    return res.json(product[resource]);
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const resource = req.params.resource;
        if (!VALID_RESOURCES.has(resource)) {
          return cb(new Error("Recurso no permitido"));
        }
        return cb(null, UPLOAD_DIRS[resource]);
      },
      filename: (req, file, cb) => {
        const extension = path.extname(file.originalname).toLowerCase();
        const safeId = req.params.id.replace(/[^a-z0-9_-]/gi, "");
        if (!safeId) {
          return cb(new Error("ID inválido"));
        }
        const safeName = `${safeId}-${req.params.resource}-${Date.now()}${extension}`;
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

      const relativePath = path.posix.normalize(
        path.relative(__dirname, req.file.path).split(path.sep).join("/")
      );

      const previous = updateResource(product, resource, {
        type: "file",
        path: relativePath
      });
      if (previous.type === "file" && previous.path && previous.path !== relativePath) {
        safeUnlink(previous.path);
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
    if (err.code === "EBADCSRFTOKEN") {
      if (req.path.startsWith("/admin/api")) {
        return res.status(403).json({ error: "Token CSRF inválido." });
      }
      return res.status(403).send("Token CSRF inválido.");
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
