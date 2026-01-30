import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
import multer from "multer";
import FormData from "form-data";
import { OAuth2Client } from "google-auth-library";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const upload = multer();
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost:3000/auth/google/callback"
);

const LINKS_FILE = path.join(process.cwd(), "google-links.json");

function getLinks() {
  try {
    return JSON.parse(fs.readFileSync(LINKS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveLinks(links) {
  fs.writeFileSync(LINKS_FILE, JSON.stringify(links, null, 2));
}

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3000;
const MOODLE_BASE = process.env.MOODLE_BASE;
const MOODLE_SERVICE = process.env.MOODLE_SERVICE || "app_movil";

// ===== Helpers =====

// Extrae el token limpio del header Authorization
function getUserAuth(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  if (auth.length > 0) return auth.trim();
  return null;
}

// Llamada estándar a Moodle (siempre usa el token del usuario logueado)
async function moodleCall(req, wsfunction, params = {}) {
  const token = getUserAuth(req);
  if (!token) throw new Error("Token no proporcionado");

  const url = `${MOODLE_BASE}/webservice/rest/server.php`;
  const body = new URLSearchParams({
    wstoken: token,
    wsfunction,
    moodlewsrestformat: "json",
    ...params,
  });

  const { data } = await axios.post(url, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (data?.exception) throw new Error(data.message);
  return data;
}

// Verificar si un email está registrado en Moodle
async function isEmailInMoodle(email) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      console.log("⚠️ ADMIN_TOKEN no configurado, saltando validación de email");
      return true; // Si no hay token admin, permitir por ahora
    }

    const url = `${MOODLE_BASE}/webservice/rest/server.php`;
    const params = new URLSearchParams({
      wstoken: adminToken,
      wsfunction: "core_user_get_users_by_field",
      moodlewsrestformat: "json",
      field: "email",
      "values[0]": email,
    });

    const { data } = await axios.post(url, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    if (data?.exception || data?.errorcode) {
      console.log("⚠️ Error buscando usuario:", data.message || data.errorcode);
      return true; // En caso de error, permitir para no bloquear
    }

    return data && data.length > 0;
  } catch (error) {
    console.log("⚠️ Error verificando email:", error.message);
    return true; // En caso de error, permitir
  }
}

// ===== RUTAS =====

app.get("/health", (req, res) => res.json({ ok: true, mode: "standard-auth" }));

// OAuth Google - Inicio del flujo
app.get("/auth/google/start", (req, res) => {
  const authUrl = googleClient.generateAuthUrl({
    access_type: "offline",
    scope: ["email", "profile"],
    prompt: "select_account",
  });
  res.redirect(authUrl);
});

// OAuth Google - Callback
app.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect("http://localhost:8081?error=no_code");
  }

  try {
    const { tokens } = await googleClient.getToken(code);
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload.email;

    // Verificar si ya está vinculado
    const links = getLinks();
    if (links[email]) {
      // Auto-login
      const { moodleUsername, moodlePassword } = links[email];
      const loginUrl = `${MOODLE_BASE}/login/token.php`;
      const params = new URLSearchParams({
        username: moodleUsername,
        password: moodlePassword,
        service: MOODLE_SERVICE,
      });

      const { data: loginData } = await axios.post(loginUrl, params);

      if (loginData.token) {
        const userUrl = `${MOODLE_BASE}/webservice/rest/server.php`;
        const userParams = new URLSearchParams({
          wstoken: loginData.token,
          wsfunction: "core_webservice_get_site_info",
          moodlewsrestformat: "json",
        });

        const { data: userData } = await axios.post(userUrl, userParams);

        return res.redirect(
          `http://localhost:8081?token=${loginData.token}&user=${encodeURIComponent(JSON.stringify(userData))}`
        );
      }
    }

    // Necesita vincular
    return res.redirect(
      `http://localhost:8081?requires_linking=true&google_email=${email}&google_name=${encodeURIComponent(payload.name || "")}&id_token=${tokens.id_token}`
    );
  } catch (error) {
    console.error("❌ Error en callback:", error);
    return res.redirect(`http://localhost:8081?error=${encodeURIComponent(error.message)}`);
  }
});

// 1. LOGIN (Devuelve Token Real)
app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Obtener Token
    const tokenUrl = `${MOODLE_BASE}/login/token.php`;
    const { data: tokenData } = await axios.get(tokenUrl, {
      params: { username, password, service: MOODLE_SERVICE },
    });

    if (tokenData?.error) return res.status(401).json({ ok: false, error: tokenData.error });

    // Obtener Info Usuario
    const infoBody = new URLSearchParams({
        wstoken: tokenData.token,
        wsfunction: "core_webservice_get_site_info",
        moodlewsrestformat: "json",
    });
    const { data: info } = await axios.post(`${MOODLE_BASE}/webservice/rest/server.php`, infoBody.toString());

    res.json({
      ok: true,
      token: tokenData.token,
      user: {
          id: info.userid,
          fullname: info.fullname,
          email: username,
          avatar: info.userpictureurl
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 2. LOGIN CON GOOGLE
app.post("/auth/google", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ ok: false, error: "Token no proporcionado" });

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const googleEmail = payload.email;
    
    // VALIDAR: Verificar si el email está registrado en Moodle
    const emailExists = await isEmailInMoodle(googleEmail);
    if (!emailExists) {
      console.log("❌ Correo no registrado en Moodle:", googleEmail);
      return res.status(403).json({ 
        ok: false, 
        error: "Correo no registrado. Este correo no está registrado en el sistema Moodle." 
      });
    }
    
    // Verificar si ya está vinculado
    const links = getLinks();
    const linkedAccount = links[googleEmail];
    
    if (linkedAccount) {
      // Ya está vinculado, hacer login automático
      console.log("✅ Cuenta vinculada encontrada para:", googleEmail);
      const tokenUrl = `${MOODLE_BASE}/login/token.php`;
      const { data: tokenData } = await axios.get(tokenUrl, {
        params: { 
          username: linkedAccount.moodleUsername, 
          password: linkedAccount.moodlePassword, 
          service: MOODLE_SERVICE 
        },
      });

      if (tokenData?.error) {
        // Credenciales cambiaron, pedir vincular de nuevo
        delete links[googleEmail];
        saveLinks(links);
        return res.json({
          ok: true,
          requiresLinking: true,
          googleUser: {
            email: payload.email,
            name: payload.name,
            picture: payload.picture
          }
        });
      }

      const infoBody = new URLSearchParams({
        wstoken: tokenData.token,
        wsfunction: "core_webservice_get_site_info",
        moodlewsrestformat: "json",
      });
      const { data: info } = await axios.post(`${MOODLE_BASE}/webservice/rest/server.php`, infoBody.toString());

      return res.json({
        ok: true,
        token: tokenData.token,
        user: {
          id: info.userid,
          fullname: info.fullname,
          email: info.useremail || googleEmail,
          avatar: info.userpictureurl || payload.picture,
          googleEmail: payload.email,
          linkedToGoogle: true
        }
      });
    }

    // No está vinculado - pedir vincular
    console.log("📝 Correo no vinculado:", googleEmail);
    res.json({
      ok: true,
      requiresLinking: true,
      googleUser: {
        email: payload.email,
        name: payload.name,
        picture: payload.picture
      }
    });
  } catch (e) {
    console.error("❌ Error login Google:", e);
    res.status(500).json({ ok: false, error: "Error verificando token de Google" });
  }
});

// 3. VINCULAR GOOGLE CON MOODLE
app.post("/auth/link-google-moodle", async (req, res) => {
  try {
    const { idToken, username, password } = req.body;

    if (!idToken || !username || !password) {
      return res.status(400).json({ ok: false, error: "Faltan datos requeridos" });
    }

    console.log("📝 Vinculando Google con Moodle...");
    
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const googleEmail = payload.email;
    console.log("✅ Google verificado:", googleEmail);

    const tokenUrl = `${MOODLE_BASE}/login/token.php`;
    const { data: tokenData } = await axios.get(tokenUrl, {
      params: { username, password, service: MOODLE_SERVICE },
    });

    if (tokenData?.error) {
      console.log("❌ Error Moodle:", tokenData.error);
      return res.status(401).json({ 
        ok: false, 
        error: "Usuario o contraseña de Moodle incorrectos" 
      });
    }

    console.log("✅ Login Moodle exitoso");

    const infoBody = new URLSearchParams({
        wstoken: tokenData.token,
        wsfunction: "core_webservice_get_site_info",
        moodlewsrestformat: "json",
    });
    const { data: info } = await axios.post(`${MOODLE_BASE}/webservice/rest/server.php`, infoBody.toString());

    console.log("✅ Info usuario obtenida:", info.fullname);

    // VALIDACIÓN: Verificar que esta cuenta de Moodle no esté vinculada a otro correo
    const links = getLinks();
    const existingGoogleEmail = Object.keys(links).find(
      email => links[email].moodleUsername === username && email !== googleEmail
    );

    if (existingGoogleEmail) {
      console.log("❌ Cuenta ya vinculada a:", existingGoogleEmail);
      return res.status(403).json({ 
        ok: false, 
        error: `Esta cuenta de Moodle ya está vinculada al correo ${existingGoogleEmail}. Una cuenta solo puede vincularse a un correo de Google.` 
      });
    }

    // Guardar vinculación (sobrescribe si ya existía para este email)
    links[googleEmail] = {
      moodleUsername: username,
      moodlePassword: password,
      linkedAt: new Date().toISOString()
    };
    saveLinks(links);
    console.log("💾 Vinculación guardada para:", googleEmail);

    res.json({
      ok: true,
      token: tokenData.token,
      user: {
        id: info.userid,
        fullname: info.fullname,
        email: info.useremail || username,
        avatar: info.userpictureurl || payload.picture,
        googleEmail: payload.email,
        linkedToGoogle: true
      }
    });
  } catch (e) {
    console.error("❌ Error en vincular:", e.message);
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// === MIDDLEWARE DE SEGURIDAD ===
// A partir de aquí, todas las rutas exigen token
app.use((req, res, next) => {
    if (!getUserAuth(req)) return res.status(401).json({ error: "Falta el token de sesión" });
    next();
});

// 4. CURSOS
app.get("/courses", async (req, res) => {
  try {
    const data = await moodleCall(req, "core_course_get_enrolled_courses_by_timeline_classification", {
        classification: "inprogress"
    });
    res.json({ ok: true, courses: data.courses || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 5. CONTENIDOS
app.get("/course/:courseId/contents", async (req, res) => {
  try {
    const contents = await moodleCall(req, "core_course_get_contents", { courseid: req.params.courseId });
    res.json({ ok: true, contents });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 6. TAREAS (ASSIGNMENTS)

// ✅ NUEVO: Obtener estado de la entrega (Corrige el error de "Tipo no detectado")
app.get("/assign/:assignId/status", async (req, res) => {
  try {
    const data = await moodleCall(req, "mod_assign_get_submission_status", { 
        assignid: req.params.assignId 
    });
    res.json({ ok: true, status: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Guardar Texto Online
app.post("/assign/:assignId/save-text", async (req, res) => {
  try {
    const { text } = req.body;
    const result = await moodleCall(req, "mod_assign_save_submission", {
        assignmentid: req.params.assignId,
        "plugindata[onlinetext_editor][text]": text,
        "plugindata[onlinetext_editor][format]": 1,
        "plugindata[onlinetext_editor][itemid]": 0
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ✅ NUEVO: Botón "Enviar Tarea" (Submit for grading)
app.post("/assign/:assignId/submit", async (req, res) => {
  try {
    const result = await moodleCall(req, "mod_assign_submit_for_grading", {
        assignmentid: req.params.assignId,
        acceptsubmissionstatement: 1
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Subida de Archivo (Proxy Simple)
// ✅ SUBIDA DE ARCHIVOS REAL (Draft Area -> Tarea)
app.post("/assign/:assignId/save-file", upload.single("file"), async (req, res) => {
  try {
    const token = getUserAuth(req);
    if (!token) return res.status(401).json({ error: "Falta token" });
    if (!req.file) return res.status(400).json({ error: "No se recibió archivo" });

    // PASO 1: Subir el archivo a la "Zona de Borradores" (Draft Area) de Moodle
    // Esto no lo envía a la tarea todavía, Moodle lo guarda temporalmente y nos da un ID.
    const uploadUrl = `${MOODLE_BASE}/webservice/upload.php`;
    
    const form = new FormData();
    form.append("token", token);
    form.append("file", req.file.buffer, req.file.originalname);
    
    // Axios necesita headers especiales para multipart/form-data
    const uploadRes = await axios.post(uploadUrl, form, {
        headers: form.getHeaders() 
    });

    const uploadedFiles = uploadRes.data;

    // Validación de errores de Moodle
    if (uploadedFiles.error) throw new Error(uploadedFiles.error);
    if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) {
        // A veces Moodle devuelve el error dentro del primer objeto
        if (uploadedFiles.exception) throw new Error(uploadedFiles.message);
        throw new Error("Error desconocido al subir archivo al Draft Area");
    }

    // El ID mágico que necesitamos es 'itemid'
    const draftItemId = uploadedFiles[0].itemid;
    console.log(`📂 Archivo subido a Draft Area. ItemID: ${draftItemId}`);

    // PASO 2: Guardar la entrega en la Tarea usando ese ID
    // 'plugindata[files_filemanager]' es el campo estándar para adjuntos en tareas
    const result = await moodleCall(req, "mod_assign_save_submission", {
        assignmentid: req.params.assignId,
        "plugindata[files_filemanager]": draftItemId
    });

    res.json({ ok: true, result });

  } catch (e) {
    console.error("❌ Error Upload:", e.response?.data || e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 5. FOROS

app.get("/forum/:forumId/discussions", async (req, res) => {
  try {
    const data = await moodleCall(req, "mod_forum_get_forum_discussions", { forumid: req.params.forumId });
    res.json({ ok: true, discussions: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/discussion/:discussionId/posts", async (req, res) => {
  try {
    const data = await moodleCall(req, "mod_forum_get_discussion_posts", { discussionid: req.params.discussionId });
    res.json({ ok: true, posts: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ✅ NUEVO: Responder en Foro (Corrige Error 404)
app.post("/forum/reply", async (req, res) => {
  try {
    const { postid, subject, message } = req.body;
    
    const result = await moodleCall(req, "mod_forum_add_discussion_post", {
        postid: postid,
        subject: subject,
        message: message,
        "options[0][name]": "discussionsubscribe",
        "options[0][value]": true
    });
    
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 6. NOTAS
app.get("/course/:courseId/grades", async (req, res) => {
  try {
    const data = await moodleCall(req, "gradereport_user_get_grade_items", { courseid: req.params.courseId });
    res.json({ ok: true, grades: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 7. DESCARGA DE ARCHIVOS (Proxy Seguro)
app.get("/file", async (req, res) => {
  try {
    const u = req.query.u;
    if (!u) return res.status(400).json({ error: "Falta URL" });
    
    const token = getUserAuth(req);
    const urlObj = new URL(decodeURIComponent(u));
    urlObj.searchParams.set("token", token); // Inyectamos token del usuario

    const response = await axios.get(urlObj.toString(), { 
        responseType: "stream", 
        timeout: 20000 
    });
    
    if (response.headers["content-type"]) res.setHeader("Content-Type", response.headers["content-type"]);
    response.data.pipe(res);
  } catch (e) {
    res.status(500).json({ ok: false, error: "Error descargando archivo" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Backend STANDARD (Sin Google) corriendo en puerto ${PORT}`);
});