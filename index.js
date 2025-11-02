const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");

// =======================
// Configuração Firebase Admin (com variáveis de ambiente)
// =======================

const serviceAccount = {
  type: process.env.TYPE,
  project_id: process.env.PROJECT_ID,
  private_key_id: process.env.PRIVATE_KEY_ID,
  private_key: process.env.PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.CLIENT_EMAIL,
  client_id: process.env.CLIENT_ID,
  auth_uri: process.env.AUTH_URI,
  token_uri: process.env.TOKEN_URI,
  auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.CLIENT_X509_CERT_URL,
  universe_domain: process.env.UNIVERSE_DOMAIN
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// =======================
// Configuração Express
// =======================
const app = express();
app.use(bodyParser.json());

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
      displayName: nome
    });

    const uid = userRecord.uid;

    await db.collection("users").doc(uid).set({
      email,
      nome,
      fcmToken: "",
      espDevices: []
    });

    res.status(201).send({ uid });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

// Login
app.post("/auth/login", async (req, res) => {
  const { uid } = req.body;
  try {
    const userRecord = await admin.auth().getUser(uid);
    res.status(200).send({
      uid: userRecord.uid,
      displayName: userRecord.displayName
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

// =======================
// Rotas ESP
// =======================

// Cadastrar ESP
app.post("/esp/register", async (req, res) => {
  const { uid, mac, nome } = req.body;
  try {
    await db.collection("espDevices").doc(mac).set({
      userId: uid,
      nome
    });

    const userRef = db.collection("users").doc(uid);
    await userRef.update({
      espDevices: admin.firestore.FieldValue.arrayUnion(mac)
    });

    res.status(201).send({ msg: "ESP cadastrado com sucesso" });
  } catch (error) {
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
        body: mensagem
      }
    };

    await admin.messaging().send(messageFCM);
    res.status(200).send({ msg: "Notificação enviada" });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

// =======================
// Iniciar servidor
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
