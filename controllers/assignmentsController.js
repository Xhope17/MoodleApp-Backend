import axios from "axios";
import FormData from "form-data";
import { moodleCall, getUserAuth } from "../helpers/moodle.js";
import { MOODLE_BASE } from "../config/env.js";

// Obtiene todas las tareas de un curso con sus detalles
export async function getCourseAssignments(req, res) {
  try {
    const courseId = parseInt(req.params.courseId);
    const data = await moodleCall(req, "mod_assign_get_assignments", {
      "courseids[0]": courseId,
    });
    res.json({ ok: true, assignments: data.courses?.[0]?.assignments || [] });
  } catch (e) {
    console.error("Error en getCourseAssignments:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
}

// Obtiene el estado de una tarea y su entrega
export async function getAssignmentStatus(req, res) {
  try {
    // Primero obtener el userid del token
    const userInfo = await moodleCall(req, "core_webservice_get_site_info", {});
    const userId = userInfo.userid;
    
    const data = await moodleCall(req, "mod_assign_get_submission_status", {
      assignid: req.params.assignId,
      userid: userId,
    });
    
    res.json({ ok: true, status: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// Guarda el texto de una tarea en linea
export async function saveAssignmentText(req, res) {
  try {
    const { text } = req.body;
    const result = await moodleCall(req, "mod_assign_save_submission", {
      assignmentid: req.params.assignId,
      "plugindata[onlinetext_editor][text]": text,
      "plugindata[onlinetext_editor][format]": 1,
      "plugindata[onlinetext_editor][itemid]": 0,
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// Envia una tarea para calificacion
export async function submitAssignment(req, res) {
  try {
    const result = await moodleCall(req, "mod_assign_submit_for_grading", {
      assignmentid: req.params.assignId,
      acceptsubmissionstatement: 1,
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// Sube un archivo como entrega de tarea
export async function saveAssignmentFile(req, res) {
  try {
    const token = getUserAuth(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Falta token" });
    }

    if (!req.file) {
      return res
        .status(400)
        .json({ ok: false, error: "No se recibió archivo" });
    }

    const uploadUrl = `${MOODLE_BASE}/webservice/upload.php`;

    const form = new FormData();
    form.append("token", token);
    form.append("file", req.file.buffer, req.file.originalname);

    console.log("Subiendo a Moodle:", uploadUrl);

    const uploadRes = await axios.post(uploadUrl, form, {
      headers: form.getHeaders(),
    });

    const uploadedFiles = uploadRes.data;
    console.log("Respuesta de Moodle:", uploadedFiles);

    if (uploadedFiles.error) {
      console.log("Error de Moodle:", uploadedFiles.error);
      throw new Error(uploadedFiles.error);
    }
    if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) {
      if (uploadedFiles.exception) {
        console.log("Excepción de Moodle:", uploadedFiles.message);
        throw new Error(uploadedFiles.message);
      }
      console.log("Array vacío o inválido");
      throw new Error("Error desconocido al subir archivo al Draft Area");
    }

    const draftItemId = uploadedFiles[0].itemid;

    const result = await moodleCall(req, "mod_assign_save_submission", {
      assignmentid: req.params.assignId,
      "plugindata[files_filemanager]": draftItemId,
    });

    res.json({ ok: true, result });
  } catch (e) {
    const errorMsg =
      e.response?.data?.message || e.message || "Error desconocido";
    res.status(500).json({ ok: false, error: errorMsg });
  }
}

// Guarda la entrega combinada (texto + archivos) de una tarea
export async function saveAssignmentCombined(req, res) {
  try {
    const token = getUserAuth(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Falta token" });
    }

    const { text } = req.body;
    const hasFiles = req.files && req.files.length > 0;
    const hasText = text && text.trim && text.trim().length > 0;

    // Permitir envíos vacíos para borrar entregas
    // Si ambos están vacíos, se enviará un draft vacío a Moodle para limpiar la entrega

    let draftItemId = null;

    // Si hay archivos, subirlos todos
    if (hasFiles) {
      const uploadUrl = `${MOODLE_BASE}/webservice/upload.php`;
      console.log(`Subiendo ${req.files.length} archivo(s) a Moodle...`);
      
      // Subir cada archivo al mismo draft area
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        
        const form = new FormData();
        form.append("token", token);
        form.append("file", file.buffer, file.originalname);
        
        // Si ya tenemos un draftItemId, lo usamos para agregar al mismo draft area
        if (draftItemId !== null) {
          form.append("itemid", String(draftItemId));
        }

        const uploadRes = await axios.post(uploadUrl, form, {
          headers: form.getHeaders(),
        });

        const uploadedFiles = uploadRes.data;

        if (uploadedFiles.error) {
          throw new Error(uploadedFiles.error);
        }
        if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) {
          if (uploadedFiles.exception) {
            throw new Error(uploadedFiles.message);
          }
          throw new Error("Error desconocido al subir archivo al Draft Area");
        }

        // Guardar el itemid del primer archivo
        if (draftItemId === null) {
          draftItemId = uploadedFiles[0].itemid;
        }
      }
      
      console.log(`✓ ${req.files.length} archivo(s) subido(s) exitosamente`);
    }

    // Preparar los datos para la llamada a Moodle
    const submissionData = {
      assignmentid: req.params.assignId,
    };

    // Si no hay texto ni archivos, es un borrado de entrega
    const isDeleting = !hasText && !hasFiles;

    if (isDeleting) {
      console.log("🗑️ Detectado intento de borrado de entrega");
      // Para borrar: enviar texto vacío y draft area vacío (itemid 0)
      submissionData["plugindata[onlinetext_editor][text]"] = "";
      submissionData["plugindata[onlinetext_editor][format]"] = 1;
      submissionData["plugindata[onlinetext_editor][itemid]"] = 0;
      submissionData["plugindata[files_filemanager]"] = 0;
      console.log("Datos para borrar:", submissionData);
    } else {
      // Agregar texto si existe
      if (hasText) {
        submissionData["plugindata[onlinetext_editor][text]"] = text;
        submissionData["plugindata[onlinetext_editor][format]"] = 1;
        submissionData["plugindata[onlinetext_editor][itemid]"] = 0;
      }

      // Agregar archivos si existen
      if (draftItemId !== null) {
        submissionData["plugindata[files_filemanager]"] = draftItemId;
      }
    }
    
    const result = await moodleCall(req, "mod_assign_save_submission", submissionData);
    
    if (isDeleting) {
      console.log("✓ Respuesta de Moodle al borrar:", JSON.stringify(result, null, 2));
    }
    
    res.json({ ok: true, result });
  } catch (e) {
    const errorMsg = e.response?.data?.message || e.message || "Error desconocido";
    console.error("Error en saveAssignmentCombined:", errorMsg);
    res.status(500).json({ ok: false, error: errorMsg });
  }
}
