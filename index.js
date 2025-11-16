// =======================
// index.js - Backend completo (Firebase + ESP + Notificações)
// =======================

require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const cors = require("cors");

// =======================
// Verifica se a PRIVATE_KEY existe
// =======================
if (!process.env.PRIVATE_KEY) {
  throw new Error("A variável PRIVATE_KEY não está definida!");
}

// =======================
// Configuração Firebase Admin
// =======================
const serviceAccount = {
  type: process.env.TYPE,
  project_id: process.env.PROJECT_ID,
  private_key_id: process.env.PRIVATE_KEY_ID,
  private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.CLIENT_EMAIL,
  client_id: process.env.CLIENT_ID,
  auth_uri: process.env.AUTH_URI,
  token_uri: process.env.TOKEN_URI,
  auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.CLIENT_X509_CERT_URL,
  universe_domain: process.env.UNIVERSE_DOMAIN,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// =======================
// Configuração Express
// =======================
const app = express();

app.use(cors({
  origin: [
    "http://localhost:8100",
    "https://localhost",
    "capacitor://localhost",
    "ionic://localhost",
    "https://alertaseguro-frontend.vercel.app"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(bodyParser.json());

// Log simples para debug
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url} | Body:`, req.body);
  next();
});

// =======================
// Rotas Auth
// =======================

// Registrar usuário
app.post("/auth/register", async (req, res) => {
  const { email, password, nome } = req.body;
  try {
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: nome,
    });

    const uid = userRecord.uid;

    await db.collection("users").doc(uid).set({
      email,
      nome,
      fcmToken: "",
    });

    res.status(201).send({ uid });
  } catch (error) {
    console.error("Erro ao registrar usuário:", error);
    res.status(400).send({ error: error.message });
  }
});

// Teste rápido de backend
app.get("/auth/test", (req, res) => {
  res.status(200).send("✅ Backend acessível com sucesso!");
});

// Login
app.post("/auth/login", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).send({ error: "O email é obrigatório" });
  }

  try {
    const userRecord = await admin.auth().getUserByEmail(email);

    res.status(200).send({
      uid: userRecord.uid,
      displayName: userRecord.displayName,
      email: userRecord.email
    });
  } catch (error) {
    console.error("Erro ao logar:", error);
    res.status(400).send({ error: error.message });
  }
});

// =======================
// Rota para salvar token FCM
// =======================
app.post("/api/token", async (req, res) => {
  const { uid, token } = req.body;

  if (!uid || !token) {
    return res.status(400).send({ error: "UID e token são obrigatórios" });
  }

  try {
    await db.collection("users").doc(uid).update({ fcmToken: token });
    res.status(200).send({ msg: "✅ Token FCM salvo com sucesso!" });
  } catch (error) {
    console.error("Erro ao salvar token FCM:", error);
    res.status(400).send({ error: error.message });
  }
});

// =======================
// LISTAR ESPS DE UM USUÁRIO
// =======================
app.get("/users/:uid/esp/list", async (req, res) => {
  const { uid } = req.params;

  try {
    const snap = await db
      .collection("users")
      .doc(uid)
      .collection("espDevices")
      .get();

    const lista = snap.docs.map(doc => doc.data());

    return res.status(200).json(lista);
  } catch (error) {
    console.error("Erro ao listar dispositivos:", error);
    return res.status(500).json({ error: "Erro ao listar dispositivos" });
  }
});

// =======================
// Rotas ESP
// =======================

// Cadastrar ESP dentro do usuário
app.post("/esp/register", async (req, res) => {
  const { uid, mac, nome, localizacao = "", tipo = "" } = req.body;

  if (!uid || !mac || !nome) {
    return res.status(400).send({ error: "UID, MAC e nome são obrigatórios" });
  }

  try {
    const espRef = db
      .collection("users")
      .doc(uid)
      .collection("espDevices")
      .doc(mac);

    await espRef.set({
      mac,
      nome,
      localizacao,
      tipo,
      userId: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(201).send({ msg: "✅ Sensor cadastrado na subcoleção com sucesso" });
  } catch (error) {
    console.error("Erro ao cadastrar ESP:", error);
    res.status(400).send({ error: error.message });
  }
});

// ================================
// 📌 SALVAR HORÁRIOS PROGRAMADOS
// ================================
app.post("/esp/:mac/horarios", async (req, res) => {
  const { mac } = req.params;
  const { inicio, fim, dias, ativo } = req.body;

  if (!inicio || !fim || !dias) {
    return res.status(400).send({ error: "Campos obrigatórios ausentes." });
  }

  try {
    // buscar ESP pelo mac
    const espQuery = await db.collectionGroup("espDevices")
      .where("mac", "==", mac)
      .get();

    if (espQuery.empty)
      return res.status(404).send({ error: "ESP não encontrado" });

    const espRef = espQuery.docs[0].ref;

    // salvar subcoleção "horarios"
    await espRef.collection("horarios").add({
      inicio,
      fim,
      dias,
      ativo,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(201).send({ msg: "⏰ Horário salvo com sucesso!" });

  } catch (error) {
    console.error("Erro ao salvar horário:", error);
    return res.status(500).send({ error: "Erro ao salvar horário" });
  }
});

// ================================
// 📌 LISTAR HORÁRIOS PROGRAMADOS
// ================================
app.get("/esp/:mac/horarios", async (req, res) => {
  const { mac } = req.params;

  try {
    const espQuery = await db.collectionGroup("espDevices")
      .where("mac", "==", mac)
      .get();

    if (espQuery.empty)
      return res.status(404).send({ error: "ESP não encontrado" });

    const espRef = espQuery.docs[0].ref;

    const snap = await espRef.collection("horarios").get();

    const lista = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return res.status(200).json(lista);

  } catch (error) {
    console.error("Erro ao listar horários:", error);
    return res.status(500).send({ error: "Erro ao listar horários" });
  }
});

// =======================
// Receber evento do ESP e enviar notificação
// =======================
app.post("/esp/event", async (req, res) => {
  const { mac, mensagem } = req.body;

  try {
    // 1. Buscar ESP pelo mac
    const espQuery = await db.collectionGroup("espDevices")
      .where("mac", "==", mac)
      .get();

    if (espQuery.empty)
      return res.status(404).send({ error: "ESP não cadastrado" });

    const espDoc = espQuery.docs[0];
    const espRef = espDoc.ref;
    const { userId } = espDoc.data();

    // 2. Buscar horários programados
    const horariosSnap = await espRef.collection("horarios").get();
    const horarios = horariosSnap.docs.map(d => d.data());

    if (horarios.length === 0) {
      console.log("⚠ Sem horários programados. Não enviar notificação.");
      return res.status(200).send({ msg: "Sem horários ativos" });
    }

    // 3. Verificar dia e hora atual
    const agora = new Date();
    const diaSemana = agora.getDay(); // 0 = domingo
    const horaAtual = agora.toTimeString().slice(0, 5); // "HH:MM"

    let permitido = false;

    for (const h of horarios) {
      if (!h.ativo) continue;

      // Verifica dia
      if (!h.dias.includes(diaSemana)) continue;

      // Verifica horário
      if (horaAtual >= h.inicio && horaAtual <= h.fim) {
        permitido = true;
        break;
      }
    }

    if (!permitido) {
      console.log("⛔ Evento fora do horário ou dia. Notificação bloqueada.");
      return res.status(200).send({ msg: "Evento ignorado (fora do horário)" });
    }

    // 4. Buscar Token FCM
    const userDoc = await db.collection("users").doc(userId).get();
    const { fcmToken } = userDoc.data();

    if (!fcmToken)
      return res.status(400).send({ error: "Usuário não registrou token FCM" });

    // 5. Enviar notificação
    const messageFCM = {
      token: fcmToken,
      notification: {
        title: "🚨 Alerta de Movimento",
        body: mensagem || "Movimento detectado!",
      },
    };

    await admin.messaging().send(messageFCM);

    return res.status(200).send({ msg: "Notificação enviada!" });

  } catch (error) {
    console.error("Erro ao enviar notificação:", error);
    return res.status(400).send({ error: error.message });
  }
});


// =======================
// Iniciar servidor
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
