import axios from "axios";
import { OAuth2Client } from "google-auth-library";
import { isEmailInMoodle } from "../helpers/moodle.js";
import { getLinks, saveLinks } from "../helpers/google.js";
import { MOODLE_BASE, MOODLE_SERVICE, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from "../config/env.js";

const googleClient = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  "http://localhost:3000/auth/google/callback",
);

// Verifica el estado del servidor
export async function health(req, res) {
  res.json({ ok: true, mode: "standard-auth" });
}

// Inicia el flujo de autenticacion con Google
export async function googleStart(req, res) {
  const authUrl = googleClient.generateAuthUrl({
    access_type: "offline",
    scope: ["email", "profile"],
    prompt: "select_account",
  });
  res.redirect(authUrl);
}

// Maneja la respuesta de Google OAuth
export async function googleCallback(req, res) {
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

    const links = getLinks();
    if (links[email]) {
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
          `http://localhost:8081?token=${loginData.token}&user=${encodeURIComponent(JSON.stringify(userData))}`,
        );
      }
    }

    return res.redirect(
      `http://localhost:8081?requires_linking=true&google_email=${email}&google_name=${encodeURIComponent(payload.name || "")}&id_token=${tokens.id_token}`,
    );
  } catch (error) {
    return res.redirect(
      `http://localhost:8081?error=${encodeURIComponent(error.message)}`,
    );
  }
}

// Login con usuario y contraseña de Moodle
export async function login(req, res) {
  try {
    const { username, password } = req.body;

    const tokenUrl = `${MOODLE_BASE}/login/token.php`;
    const { data: tokenData } = await axios.get(tokenUrl, {
      params: { username, password, service: MOODLE_SERVICE },
    });

    if (tokenData?.error) {
      return res.status(401).json({ ok: false, error: tokenData.error });
    }

    const infoBody = new URLSearchParams({
      wstoken: tokenData.token,
      wsfunction: "core_webservice_get_site_info",
      moodlewsrestformat: "json",
    });
    const { data: info } = await axios.post(
      `${MOODLE_BASE}/webservice/rest/server.php`,
      infoBody.toString(),
    );

    res.json({
      ok: true,
      token: tokenData.token,
      user: {
        id: info.userid,
        fullname: info.fullname,
        email: username,
        avatar: info.userpictureurl,
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// Login con cuenta de Google
export async function googleLogin(req, res) {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res
        .status(400)
        .json({ ok: false, error: "Token no proporcionado" });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const googleEmail = payload.email;

    const emailExists = await isEmailInMoodle(googleEmail);
    if (!emailExists) {
      return res.status(403).json({
        ok: false,
        error:
          "Correo no registrado. Este correo no está registrado en el sistema Moodle.",
      });
    }

    const links = getLinks();
    const linkedAccount = links[googleEmail];

    if (linkedAccount) {
      console.log("Cuenta vinculada encontrada para:", googleEmail);
      const tokenUrl = `${MOODLE_BASE}/login/token.php`;
      const { data: tokenData } = await axios.get(tokenUrl, {
        params: {
          username: linkedAccount.moodleUsername,
          password: linkedAccount.moodlePassword,
          service: MOODLE_SERVICE,
        },
      });

      if (tokenData?.error) {
        delete links[googleEmail];
        saveLinks(links);
        return res.json({
          ok: true,
          requiresLinking: true,
          googleUser: {
            email: payload.email,
            name: payload.name,
            picture: payload.picture,
          },
        });
      }

      const infoBody = new URLSearchParams({
        wstoken: tokenData.token,
        wsfunction: "core_webservice_get_site_info",
        moodlewsrestformat: "json",
      });
      const { data: info } = await axios.post(
        `${MOODLE_BASE}/webservice/rest/server.php`,
        infoBody.toString(),
      );

      return res.json({
        ok: true,
        token: tokenData.token,
        user: {
          id: info.userid,
          fullname: info.fullname,
          email: info.useremail || googleEmail,
          avatar: info.userpictureurl || payload.picture,
          googleEmail: payload.email,
          linkedToGoogle: true,
        },
      });
    }

    console.log("Correo no vinculado:", googleEmail);
    res.json({
      ok: true,
      requiresLinking: true,
      googleUser: {
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
      },
    });
  } catch (e) {
    console.error("Error login Google:", e);
    res
      .status(500)
      .json({ ok: false, error: "Error verificando token de Google" });
  }
}

// Vincula una cuenta de Google con una cuenta de Moodle
export async function linkGoogleMoodle(req, res) {
  try {
    const { idToken, username, password } = req.body;

    if (!idToken || !username || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "Faltan datos requeridos" });
    }

    console.log("Vinculando Google con Moodle...");

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const googleEmail = payload.email;
    console.log("Google verificado:", googleEmail);

    const tokenUrl = `${MOODLE_BASE}/login/token.php`;
    const { data: tokenData } = await axios.get(tokenUrl, {
      params: { username, password, service: MOODLE_SERVICE },
    });

    if (tokenData?.error) {
      console.log("Error Moodle:", tokenData.error);
      return res.status(401).json({
        ok: false,
        error: "Usuario o contraseña de Moodle incorrectos",
      });
    }

    console.log("Login Moodle exitoso");

    const infoBody = new URLSearchParams({
      wstoken: tokenData.token,
      wsfunction: "core_webservice_get_site_info",
      moodlewsrestformat: "json",
    });
    const { data: info } = await axios.post(
      `${MOODLE_BASE}/webservice/rest/server.php`,
      infoBody.toString(),
    );

    console.log("Info usuario obtenida:", info.fullname);

    const links = getLinks();
    const existingGoogleEmail = Object.keys(links).find(
      (email) =>
        links[email].moodleUsername === username && email !== googleEmail,
    );

    if (existingGoogleEmail) {
      console.log("Cuenta ya vinculada a:", existingGoogleEmail);
      return res.status(403).json({
        ok: false,
        error: `Esta cuenta de Moodle ya está vinculada al correo ${existingGoogleEmail}. Una cuenta solo puede vincularse a un correo de Google.`,
      });
    }

    links[googleEmail] = {
      moodleUsername: username,
      moodlePassword: password,
      linkedAt: new Date().toISOString(),
    };
    saveLinks(links);
    console.log("Vinculación guardada para:", googleEmail);

    res.json({
      ok: true,
      token: tokenData.token,
      user: {
        id: info.userid,
        fullname: info.fullname,
        email: info.useremail || username,
        avatar: info.userpictureurl || payload.picture,
        googleEmail: payload.email,
        linkedToGoogle: true,
      },
    });
  } catch (e) {
    console.error("Error en vincular:", e.message);
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
}
