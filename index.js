// index.js - Backend (Firebase + ESP + Notificações)
// Estrutura: coleção "usuarios" -> subcoleção "esp" -> subcoleções "horarios" e "eventos"

require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const cors = require("cors");

// =======================
// Validações iniciais
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
  // Ajusta quebras de linha que vêm do .env
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

// Log simples de requisições (ajuda a debugar)
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url} | Body:`, req.body || {});
  next();
});

// =======================
// Helpers
// =======================

/**
 * Encontra o documento "esp" a partir do MAC usando collectionGroup.
 * Retorna { espRef, ownerId, espData } ou null se não encontrado.
 */
async function findEspByMac(mac) {
  const q = await db.collectionGroup("esp")
    .where("mac", "==", mac)
    .limit(1)
    .get();

  if (q.empty) return null;

  const doc = q.docs[0];
  // `doc.ref` aponta para /usuarios/{ownerId}/esp/{mac}
  // ownerId pode ser obtido parseando o path ou lendo um campo ownerId caso tenha.
  // Vamos extrair o ownerId do path: doc.ref.path -> "usuarios/{ownerId}/esp/{mac}"
  const pathParts = doc.ref.path.split("/");
  // pathParts = ["usuarios", "{ownerId}", "esp", "{mac}"]
  const ownerId = pathParts[1];

  return { espRef: doc.ref, ownerId, espData: doc.data() };
}

// =======================
// Auth (Firebase Admin para criar/consultar usuários)
// =======================

// Registrar usuário (cria no Firebase Auth e cria documento em "usuarios")
app.post("/auth/register", async (req, res) => {
  const { email, password, nome } = req.body;

  if (!email || !password || !nome)
    return res.status(400).send({ error: "email, password e nome são obrigatórios" });

  try {
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: nome,
    });

    // Salva no Firestore em "usuarios"
    await db.collection("usuarios").doc(userRecord.uid).set({
      email,
      nome,
      fcmToken: "", // será atualizado quando o app enviar o token
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(201).send({ uid: userRecord.uid });
  } catch (error) {
    console.error("Erro ao registrar usuário:", error);
    return res.status(400).send({ error: error.message });
  }
});

// Login - retorna UID (a autenticação real pode ficar no frontend com Firebase Auth)
app.post("/auth/login", async (req, res) => {
  const { email } = req.body;

  if (!email)
    return res.status(400).send({ error: "O email é obrigatório" });

  try {
    const userRecord = await admin.auth().getUserByEmail(email);

    return res.status(200).send({
      uid: userRecord.uid,
      displayName: userRecord.displayName,
      email: userRecord.email
    });
  } catch (error) {
    console.error("Erro ao logar:", error);
    return res.status(400).send({ error: error.message });
  }
});

// Salvar token FCM no documento do usuário (coleção "usuarios")
app.post("/api/token", async (req, res) => {
  const { uid, token } = req.body;

  if (!uid || !token)
    return res.status(400).send({ error: "UID e token são obrigatórios" });

  try {
    const userRef = db.collection("usuarios").doc(uid);
    await userRef.set({ fcmToken: token }, { merge: true });
    return res.status(200).send({ msg: "Token salvo com sucesso!" });
  } catch (error) {
    console.error("Erro ao salvar token:", error);
    return res.status(400).send({ error: error.message });
  }
});

// =======================
// ESP - CRUD e listagens
// =======================

// Listar dispositivos de um usuário
app.get("/usuarios/:uid/esp/list", async (req, res) => {
  const { uid } = req.params;

  if (!uid) return res.status(400).send({ error: "UID é obrigatório" });

  try {
    const snap = await db
      .collection("usuarios")
      .doc(uid)
      .collection("esp")
      .get();

    const lista = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return res.status(200).json(lista);
  } catch (error) {
    console.error("Erro ao listar dispositivos:", error);
    return res.status(500).json({ error: "Erro ao listar dispositivos" });
  }
});

// Cadastrar ESP (salva em usuarios/{uid}/esp/{mac})
app.post("/esp/register", async (req, res) => {
  const { uid, mac, nome, localizacao = "", tipo = "" } = req.body;

  if (!uid || !mac || !nome)
    return res.status(400).send({ error: "UID, MAC e nome são obrigatórios" });

  try {
    const espRef = db
      .collection("usuarios")
      .doc(uid)
      .collection("esp")
      .doc(mac);

    // Salva ownerId como campo opcional (reduz chamadas para descobrir proprietário)
    await espRef.set({
      mac,
      nome,
      localizacao,
      tipo,
      ownerId: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return res.status(201).send({ msg: "ESP cadastrado com sucesso!" });
  } catch (error) {
    console.error("Erro ao cadastrar ESP:", error);
    return res.status(400).send({ error: error.message });
  }
});

// =======================
// HORÁRIOS PROGRAMADOS (subcoleção em cada ESP)
// =======================

// Salvar horário para um ESP identificado pelo MAC
app.post("/esp/:mac/horarios", async (req, res) => {
  const { mac } = req.params;
  const { inicio, fim, dias, ativo } = req.body;

  if (!mac || !inicio || !fim || !dias)
    return res.status(400).send({ error: "Campos obrigatórios ausentes." });

  try {
    const found = await findEspByMac(mac);

    if (!found) return res.status(404).send({ error: "ESP não encontrado" });

    const { espRef } = found;

    await espRef.collection("horarios").add({
      inicio,
      fim,
      dias, // array de dias (0-6) ou equivalente que você usa
      ativo: !!ativo,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(201).send({ msg: "Horário salvo com sucesso!" });
  } catch (error) {
    console.error("Erro ao salvar horário:", error);
    return res.status(500).send({ error: "Erro ao salvar horário" });
  }
});

// Listar horários de um ESP (por MAC)
app.get("/esp/:mac/horarios", async (req, res) => {
  const { mac } = req.params;

  if (!mac) return res.status(400).send({ error: "MAC é obrigatório" });

  try {
    const found = await findEspByMac(mac);
    if (!found) return res.status(404).send({ error: "ESP não encontrado" });

    const { espRef } = found;

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
// HISTÓRICO DE EVENTOS DO ESP
// =======================

// Registrar evento manualmente (apenas histórico)
app.post("/esp/:mac/eventos", async (req, res) => {
  const { mac } = req.params;
  const { mensagem } = req.body;

  if (!mac) return res.status(400).send({ error: "MAC é obrigatório" });

  try {
    const found = await findEspByMac(mac);
    if (!found) return res.status(404).send({ error: "ESP não encontrado" });

    const { espRef } = found;

    await espRef.collection("eventos").add({
      mensagem: mensagem || "Evento registrado",
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(201).json({ msg: "Evento registrado" });
  } catch (error) {
    console.error("Erro ao salvar evento:", error);
    return res.status(500).json({ error: "Erro ao registrar evento" });
  }
});

// Listar eventos de um ESP (por MAC)
app.get("/esp/:mac/eventos", async (req, res) => {
  const { mac } = req.params;

  if (!mac) return res.status(400).send({ error: "MAC é obrigatório" });

  try {
    const found = await findEspByMac(mac);
    if (!found) return res.status(404).send({ error: "ESP não encontrado" });

    const { espRef } = found;

    const snap = await espRef.collection("eventos")
      .orderBy("timestamp", "desc")
      .limit(50)
      .get();

    const eventos = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return res.status(200).json(eventos);
  } catch (error) {
    console.error("Erro ao listar eventos:", error);
    return res.status(500).json({ error: "Erro ao listar eventos" });
  }
});

// =======================
// ROTA PRINCIPAL RECEBENDO EVENTOS DO ESP (identificado por MAC)
// Verifica horários, registra evento e envia notificação
// =======================
app.post("/esp/event", async (req, res) => {
  const { mac, mensagem } = req.body;

  if (!mac) return res.status(400).send({ error: "MAC é obrigatório" });

  try {
    // 1) Buscar ESP e o owner
    const found = await findEspByMac(mac);
    if (!found) return res.status(404).send({ error: "ESP não cadastrado" });

    const { espRef, ownerId } = found;

    // 2) Buscar horários do ESP
    const horariosSnap = await espRef.collection("horarios").get();
    const horarios = horariosSnap.docs.map(d => d.data());

    if (horarios.length === 0) {
      console.log("⚠ Sem horários programados. Notificação não enviada.");
      // Ainda registramos o evento? Neste caso original você não registra se sem horário.
      return res.status(200).send({ msg: "Sem horários ativos" });
    }

    // 3) Calcular horário atual no fuso BR (UTC-3)
    const agora = new Date();
    // atenção: serverTimestamp é UTC; aqui ajustamos para UTC-3
    const agoraBR = new Date(agora.getTime() - (3 * 60 * 60 * 1000));
    const diaSemana = agoraBR.getDay(); // 0 (domingo) - 6 (sábado)
    const horaAtual = agoraBR.toTimeString().slice(0, 5); // "HH:MM"

    console.log("📅 Dia atual (BR):", diaSemana);
    console.log("⏰ Hora atual (BR):", horaAtual);

    let permitido = false;

    for (const h of horarios) {
      if (!h.ativo) continue;

      // espera-se que h.dias seja um array com números 0-6
      if (!Array.isArray(h.dias) || !h.dias.includes(diaSemana)) continue;

      // compara strings "HH:MM" (funciona porque formato é zero-padded)
      if (horaAtual >= h.inicio && horaAtual <= h.fim) {
        permitido = true;
        break;
      }
    }

    if (!permitido) {
      console.log("⛔ Evento ignorado (fora do horário/dia)");
      return res.status(200).send({ msg: "Evento ignorado (fora do horário)" });
    }

    // 4) Buscar token FCM do usuário proprietário
    const userDocSnap = await db.collection("usuarios").doc(ownerId).get();
    if (!userDocSnap.exists) {
      console.error("Usuário dono do ESP não encontrado:", ownerId);
      return res.status(404).send({ error: "Usuário dono do ESP não encontrado" });
    }

    const userData = userDocSnap.data();
    const fcmToken = userData?.fcmToken;

    if (!fcmToken) {
      console.error("Token FCM ausente para o usuário:", ownerId);
      return res.status(400).send({ error: "Token FCM ausente" });
    }

    // 5) Registrar evento no histórico do ESP
    await espRef.collection("eventos").add({
      mensagem: mensagem || "Movimento detectado!",
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    // 6) Enviar notificação via Firebase Cloud Messaging
    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: "🚨 Alerta de Movimento",
        body: mensagem || "Movimento detectado!"
      }
    });

    return res.status(200).send({ msg: "Notificação enviada!" });
  } catch (error) {
    console.error("Erro ao processar evento:", error);
    return res.status(400).send({ error: error.message });
  }
});

// =======================
// Inicializar servidor
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
