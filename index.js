// =======================
// index.js - Backend completo (Firebase + CORS + Render compatível)
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
    "http://localhost:8100",       // Dev local web (Ionic serve)
    "https://localhost",           // App Android com Capacitor
    "capacitor://localhost",       // Android/iOS via Capacitor
    "ionic://localhost",           // iOS webview
    "https://alertaseguro-frontend.vercel.app" // Produção web
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

// =======================
// Rota de teste (para verificar se o backend está acessível)
// =======================
app.get("/auth/test", (req, res) => {
  res.status(200).send("Backend acessível com sucesso!");
});




// Login (recomendado: use Firebase Client SDK no frontend)
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
    // Atualiza o fcmToken no documento do usuário
    await db.collection("users").doc(uid).update({ fcmToken: token });
    res.status(200).send({ msg: "Token FCM salvo com sucesso!" });
  } catch (error) {
    console.error("Erro ao salvar token FCM:", error);
    res.status(400).send({ error: error.message });
  }
});


// =======================
// Rotas ESP
// =======================

// Cadastrar ESP corretamente dentro do usuário
app.post("/esp/register", async (req, res) => {
  const { uid, mac, nome, localizacao = "", tipo = "" } = req.body;

  if (!uid || !mac || !nome) {
    return res.status(400).send({ error: "UID, MAC e nome são obrigatórios" });
  }

  try {
    // Referência da subcoleção do usuário
    const espRef = db
      .collection("users")
      .doc(uid)
      .collection("espDevices")
      .doc(mac);

    // Salva o documento dentro da subcoleção
    await espRef.set({
      nome,
      localizacao,
      tipo,
      userId: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(201).send({ msg: "Sensor cadastrado na subcoleção com sucesso" });
  } catch (error) {
    console.error("Erro ao cadastrar ESP:", error);
    res.status(400).send({ error: error.message });
  }
});


// Receber evento do ESP e enviar notificação
app.post("/esp/event", async (req, res) => {
  const { mac, mensagem } = req.body;
  try {
    const espDoc = await db.collection("espDevices").doc(mac).get();
    if (!espDoc.exists)
      return res.status(404).send({ error: "ESP não cadastrado" });

    const { userId } = espDoc.data();

    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists)
      return res.status(404).send({ error: "Usuário não encontrado" });

    const { fcmToken } = userDoc.data();
    if (!fcmToken)
      return res.status(400).send({ error: "Usuário não registrou token FCM" });

    const messageFCM = {
      token: fcmToken,
      notification: {
        title: "Alerta de Movimento",
        body: mensagem,
      },
    };

    await admin.messaging().send(messageFCM);
    res.status(200).send({ msg: "Notificação enviada" });
  } catch (error) {
    console.error("Erro ao enviar notificação:", error);
    res.status(400).send({ error: error.message });
  }
});

// =======================
// Iniciar servidor
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
