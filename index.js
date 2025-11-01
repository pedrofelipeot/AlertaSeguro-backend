// backend.js
const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const firebase = require("firebase");

// =======================
// Configuração Firebase
// =======================

// Firebase Admin SDK (para backend)
const serviceAccount = require("./serviceAccountKey.json"); // Baixe do Firebase

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Firebase Client SDK (para Auth no backend)
firebase.initializeApp({
  apiKey: "AIzaSyDKjlG92GIpPFYa_R1wwSLMyG4BPyFtPis",
  authDomain: "alertaseguro-9f47e.firebaseapp.com",
  projectId: "alertaseguro-9f47e",
  storageBucket: "alertaseguro-9f47e.firebasestorage.app",
  messagingSenderId: "706008625809",
  appId: "1:706008625809:web:9c7707d28a429d0cdac530"
});

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
    const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
    const uid = userCredential.user.uid;

    // Criar documento do usuário no Firestore
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

// Login do usuário
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
    const uid = userCredential.user.uid;
    res.status(200).send({ uid });
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
    // Criar documento do ESP
    await db.collection("espDevices").doc(mac).set({
      userId: uid,
      nome
    });

    // Adicionar MAC ao array do usuário
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
    // Buscar documento do ESP
    const espDoc = await db.collection("espDevices").doc(mac).get();
    if (!espDoc.exists) return res.status(404).send({ error: "ESP não cadastrado" });

    const { userId } = espDoc.data();

    // Buscar token do usuário
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) return res.status(404).send({ error: "Usuário não encontrado" });

    const { fcmToken } = userDoc.data();
    if (!fcmToken) return res.status(400).send({ error: "Usuário não registrou token FCM" });

    // Enviar notificação FCM
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
const PORT = 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
