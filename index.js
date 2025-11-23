// =======================
// index.js - Backend completo (Firebase + ESP + Notificações)
// =======================

require('dotenv').config();
const axios = require("axios"); // coloque no topo do arquivo
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

// Log para debug
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url} | Body:`, req.body);
  next();
});


app.get('/ping', (req, res) => {
  res.json({ status: 'Backend acordado 😎' });
});

// =======================
// Auth
// =======================

app.post("/auth/register", async (req, res) => {
  const { email, password, nome } = req.body;

  if (!email || !password || !nome)
    return res.status(400).send({ error: "Dados obrigatórios faltando." });

  try {
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: nome,
    });

    await db.collection("users").doc(userRecord.uid).set({
      email,
      nome,
      fcmToken: "",
    });

    res.status(201).send({ uid: userRecord.uid });
  } catch (error) {
    console.error("Erro ao registrar:", error);
    res.status(400).send({ error: error.message });
  }
});
app.post("/auth/google", async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).send({ error: "idToken é obrigatório" });
  }

  try {
    // 1) VALIDAR TOKEN NO GOOGLE (não no Firebase ainda)
    const googleResponse = await axios.get(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
    );

    const { sub, email, name, picture } = googleResponse.data;
    const uid = sub; // ID do Google

    let userRecord;

    try {
      // 2) TENTAR BUSCAR USUÁRIO NO FIREBASE
      userRecord = await admin.auth().getUser(uid);
    } catch (err) {
      if (err.code === "auth/user-not-found") {
        // 3) SE NÃO EXISTE → CRIA NO FIREBASE AUTH  
        userRecord = await admin.auth().createUser({
          uid,
          email,
          displayName: name,
          photoURL: picture
        });
      } else {
        throw err;
      }
    }

    // 4) GARANTIR QUE TENHA UM DOCUMENTO NO FIRESTORE
    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      await userRef.set({
        email,
        nome: name || "",
        foto: picture || "",
        fcmToken: "",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return res.status(200).send({
      uid,
      email,
      nome: name
    });

  } catch (error) {
    console.error("Erro no login/cadastro Google:", error);
    return res.status(500).send({ error: "Erro ao processar login Google" });
  }
});




// =======================
// LOGIN REAL COM SENHA
// =======================
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).send({ error: "Email e senha são obrigatórios" });

  try {
    // 🔥 Login REAL usando Firebase Auth REST API
    const response = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
      {
        email,
        password,
        returnSecureToken: true
      }
    );

    const { localId } = response.data; // UID real

    // 🔍 Buscar dados extras do Firestore (nome, token, etc.)
    const userDoc = await db.collection("users").doc(localId).get();

    return res.status(200).send({
      uid: localId,
      email,
      nome: userDoc.data()?.nome || "",
    });

  } catch (error) {
    console.error("Erro no login:", error.response?.data || error.message);

    return res.status(401).send({
      error: "Email ou senha incorretos"
    });
  }
});

// Salvar token FCM
app.post("/api/token", async (req, res) => {
  const { uid, token } = req.body;

  if (!uid || !token)
    return res.status(400).send({ error: "UID e token são obrigatórios" });

  try {
    await db.collection("users").doc(uid).update({ fcmToken: token });
    res.status(200).send({ msg: "Token salvo com sucesso!" });
  } catch (error) {
    console.error("Erro ao salvar token:", error);
    res.status(400).send({ error: error.message });
  }
});

// =======================
// ESP
// =======================

// Listar dispositivos
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

// Cadastrar ESP
app.post("/esp/register", async (req, res) => {
  const { uid, mac, nome, localizacao = "", tipo = "" } = req.body;

  if (!uid || !mac || !nome)
    return res.status(400).send({ error: "UID, MAC e nome são obrigatórios" });

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

    res.status(201).send({ msg: "Sensor cadastrado com sucesso" });

  } catch (error) {
    console.error("Erro ao cadastrar ESP:", error);
    res.status(400).send({ error: error.message });
  }
});

// =======================
// HORÁRIOS PROGRAMADOS
// =======================

// Salvar horário
app.post("/esp/:uid/:mac/horarios", async (req, res) => {
  const { uid, mac } = req.params;
  const { inicio, fim, dias, ativo } = req.body;

  if (!inicio || !fim || !dias)
    return res.status(400).send({ error: "Campos obrigatórios ausentes." });

  try {
    // Acessa DIRETO no usuário certo
    const espRef = db
      .collection("users")
      .doc(uid)
      .collection("espDevices")
      .doc(mac);

    const espDoc = await espRef.get();

    if (!espDoc.exists)
      return res.status(404).send({ error: "ESP não encontrado nesse usuário." });

    await espRef.collection("horarios").add({
      inicio,
      fim,
      dias,
      ativo,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(201).send({ msg: "Horário salvo com sucesso!" });

  } catch (error) {
    console.error("Erro ao salvar horário:", error);
    return res.status(500).send({ error: "Erro ao salvar horário" });
  }
});


// 🔹 LISTAR HORÁRIOS DE UM DISPOSITIVO (com ativo calculado)
app.get("/esp/horarios/:userId/:mac", async (req, res) => {
  const { userId, mac } = req.params;

  if (!userId || !mac) {
    return res.status(400).json({ error: "UID e MAC são obrigatórios." });
  }

  try {
    const decodedMac = decodeURIComponent(mac);

    const horariosRef = db
      .collection("users")
      .doc(userId)
      .collection("espDevices")
      .doc(decodedMac)
      .collection("horarios");

    const snapshot = await horariosRef.get();

    const agora = new Date();
    const diaSemana = agora.getDay(); // 0=Dom, 1=Seg, ..., 6=Sab

    const horarios = snapshot.docs.map((doc) => {
      const data = doc.data();

      // 🔹 Formatar createdAt
      let dataFormatada = null;
      if (data.createdAt?._seconds) {
        const date = new Date(data.createdAt._seconds * 1000);
        date.setHours(date.getHours() - 3); // UTC-3
        dataFormatada =
          date.toLocaleDateString("pt-BR") +
          " " +
          date.toLocaleTimeString("pt-BR", { hour12: false });
      }

      // 🔹 Cálculo do ativo
      // Ex: "20:00" → [20,00]
      const [inicioH, inicioM] = data.inicio.split(":").map(Number);
      const [fimH, fimM] = data.fim.split(":").map(Number);

      const inicioMin = inicioH * 60 + inicioM;
      const fimMin = fimH * 60 + fimM;

      const agoraMin = agora.getHours() * 60 + agora.getMinutes();

      const dentroDoHorario = agoraMin >= inicioMin && agoraMin <= fimMin;
      const diaValido = Array.isArray(data.dias) && data.dias.includes(diaSemana);

      const ativoCalculado = dentroDoHorario && diaValido;

      return {
        id: doc.id,
        inicio: data.inicio,
        fim: data.fim,
        dias: data.dias || [],
        ativo: ativoCalculado,  // 🔥 agora ativo depende do horário atual
        createdAt: dataFormatada
      };
    });

    return res.status(200).json(horarios);

  } catch (error) {
    console.error("Erro ao listar horários:", error);
    return res.status(500).json({ error: "Erro ao listar horários" });
  }
});

app.get("/esp/horarios/:userId", async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: "UID é obrigatório." });
  }

  try {
    const espDevicesRef = db
      .collection("users")
      .doc(userId)
      .collection("espDevices");

    const espSnapshot = await espDevicesRef.get();
    const agora = new Date();
    const diaSemana = agora.getDay();

    let todosHorarios = [];

    for (const espDoc of espSnapshot.docs) {
      const mac = espDoc.id;
      const espData = espDoc.data();

      const horariosSnapshot = await espDevicesRef
        .doc(mac)
        .collection("horarios")
        .get();

      horariosSnapshot.docs.forEach(doc => {
        const data = doc.data();

        // 🔹 calcular se está ativo
        const [inicioH, inicioM] = data.inicio.split(":").map(Number);
        const [fimH, fimM] = data.fim.split(":").map(Number);

        const inicioMin = inicioH * 60 + inicioM;
        const fimMin = fimH * 60 + fimM;
        const agoraMin = agora.getHours() * 60 + agora.getMinutes();

        const dentroDoHorario = agoraMin >= inicioMin && agoraMin <= fimMin;
        const diaValido = Array.isArray(data.dias) && data.dias.includes(diaSemana);
        const ativoCalculado = dentroDoHorario && diaValido;

        todosHorarios.push({
          id: doc.id,
          mac: mac, // IMPORTANTE
          deviceName: espData.name || '',
          inicio: data.inicio,
          fim: data.fim,
          dias: data.dias || [],
          ativo: ativoCalculado
        });
      });
    }

    return res.status(200).json(todosHorarios);

  } catch (error) {
    console.error("Erro ao listar todos os horários:", error);
    return res.status(500).json({ error: "Erro ao listar horários" });
  }
});



// 🔥 LISTAR EVENTOS DE UM DISPOSITIVO
app.get("/esp/events/:userId/:mac", async (req, res) => {
  const { userId, mac } = req.params;

  try {
    // 🔹 Decodifica o MAC da URL
    const decodedMac = decodeURIComponent(mac);

    const eventsRef = db
      .collection("users")
      .doc(userId)
      .collection("espDevices")
      .doc(decodedMac)
      .collection("events")
      .orderBy("createdAt", "desc");

    const snapshot = await eventsRef.get();

    const events = snapshot.docs.map((doc) => {
      const data = doc.data();

      // JS puro: sem anotação de tipo
      let dataLocal = { ...data };

      if (data.createdAt && data.createdAt._seconds) {
        // converte timestamp Firestore para Date
        const date = new Date(data.createdAt._seconds * 1000);

        // 🔹 Ajuste para horário de Brasília (UTC-3)
        date.setHours(date.getHours() - 3);

        // adiciona campos já formatados para frontend
        dataLocal.data = date.toLocaleDateString('pt-BR'); // dd/mm/yyyy
        dataLocal.hora = date.toLocaleTimeString('pt-BR', { hour12: false }); // HH:MM:SS
      }

      return {
        id: doc.id,
        ...dataLocal,
      };
    });

    return res.status(200).json(events);
  } catch (error) {
    console.error("Erro ao buscar eventos:", error);
    return res.status(500).json({ error: "Erro ao buscar eventos" });
  }
});

app.post("/esp/event", async (req, res) => {
  const { mac, mensagem } = req.body;

  if (!mac || !mensagem) {
    return res.status(400).json({
      error: "MAC e mensagem são obrigatórios"
    });
  }

  try {
    console.log("📡 Evento recebido:", mac, mensagem);

    // ===========================
    // 1. Buscar todos usuários com esse sensor
    // ===========================
    const usersSnapshot = await db.collection("users").get();

    const usuariosComSensor = [];

    for (const userDoc of usersSnapshot.docs) {
      const espSnapshot = await userDoc.ref
        .collection("espDevices")
        .where("mac", "==", mac)
        .get();

      if (!espSnapshot.empty) {
        usuariosComSensor.push({
          userId: userDoc.id,
          deviceRef: espSnapshot.docs[0].ref,
          deviceData: espSnapshot.docs[0].data()
        });
      }
    }

    if (usuariosComSensor.length === 0) {
      console.log("❌ Nenhum usuário possui esse dispositivo:", mac);
      return res.status(404).json({ error: "Dispositivo não associado a nenhum usuário" });
    }

    console.log(`👥 Encontrado em ${usuariosComSensor.length} usuário(s)`);

    // ===========================
    // 2. Ajustar horário Brasil
    // ===========================
    const agora = new Date();
    const agoraBR = new Date(agora.getTime() - (3 * 60 * 60 * 1000));

    const diaAtual = agoraBR.getDay();
    const minutosAgora = agoraBR.getHours() * 60 + agoraBR.getMinutes();

    console.log("🕒 Agora:", agoraBR.toLocaleString());
    console.log("📅 Dia:", diaAtual, "| Minutos:", minutosAgora);

    let notificacoesEnviadas = 0;
    let eventosSalvos = 0;

    // ===========================
    // 3. Processar para cada usuário
    // ===========================
    for (const user of usuariosComSensor) {
      const { userId, deviceRef, deviceData } = user;

      const deviceName = deviceData.nome || "Sem nome";
      const mensagemFinal = `${deviceName}: ${mensagem}`;

      // Buscar horários desse usuário
      const horariosSnapshot = await deviceRef.collection("horarios").get();

      let dentroDoHorario = false;

      for (const doc of horariosSnapshot.docs) {
        const data = doc.data();

        console.log(`📄 Horário (${userId}):`, data);

        if (!data.ativo) continue;

        if (!Array.isArray(data.dias) || !data.dias.includes(diaAtual)) continue;

        const [inicioH, inicioM] = data.inicio.split(":").map(Number);
        const [fimH, fimM] = data.fim.split(":").map(Number);

        const inicioMin = inicioH * 60 + inicioM;
        const fimMin = fimH * 60 + fimM;

        if (inicioMin <= fimMin) {
          if (minutosAgora >= inicioMin && minutosAgora <= fimMin) {
            dentroDoHorario = true;
            break;
          }
        } else {
          // atravessa meia-noite
          if (minutosAgora >= inicioMin || minutosAgora <= fimMin) {
            dentroDoHorario = true;
            break;
          }
        }
      }

      // Se esse usuário está fora do horário, ignora ele
      if (!dentroDoHorario) {
        console.log(`⏭ Usuário ${userId} fora do horário, ignorado`);
        continue;
      }

      console.log(`✅ Usuário ${userId} dentro do horário`);

      // ===========================
      // 4. Salvar evento para esse usuário
      // ===========================
      const eventRef = await deviceRef.collection("events").add({
        mensagem: mensagemFinal,
        deviceName,
        mac,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        notificado: false
      });

      eventosSalvos++;

      // ===========================
      // 5. Buscar token e notificar
      // ===========================
      const userDoc = await db.collection("users").doc(userId).get();
      const fcmToken = userDoc.data()?.fcmToken;

      if (!fcmToken) {
        console.warn(`⚠ Usuário ${userId} sem token FCM`);
        continue;
      }

      await admin.messaging().send({
        token: fcmToken,
        notification: {
          title: "Alerta Seguro",
          body: mensagemFinal
        },
        data: {
          mac,
          mensagem: mensagemFinal
        }
      });

      await eventRef.update({ notificado: true });

      notificacoesEnviadas++;
      console.log(`📩 Notificação enviada para ${userId}`);
    }

    console.log("✅ Processamento finalizado");

    return res.json({
      success: true,
      totalUsuarios: usuariosComSensor.length,
      eventosSalvos,
      notificacoesEnviadas
    });

  } catch (error) {
    console.error("❌ Erro no /esp/event:", error);

    return res.status(500).json({
      error: "Erro interno no servidor"
    });
  }
});



// DELETE /usuario/:uid
app.delete("/usuario/:uid", async (req, res) => {
  const { uid } = req.params;

  try {
    // Deleta usuário no Firebase Auth
    await admin.auth().deleteUser(uid);

    // Deleta usuário no Firestore
    await db.collection("users").doc(uid).delete();

    return res.status(200).json({ message: "Usuário deletado com sucesso" });
  } catch (error) {
    console.error("Erro ao deletar usuário:", error);
    return res.status(500).json({ error: error.message });
  }
});
// DELETE /esp/:uid/:mac
app.delete("/esp/:uid/:mac", async (req, res) => {
  const { uid, mac } = req.params;

  try {
    const espRef = db
      .collection("users")
      .doc(uid)
      .collection("espDevices")
      .doc(mac);

    const docSnap = await espRef.get();

    if (!docSnap.exists)
      return res.status(404).json({ error: "Sensor não encontrado" });

    // 🔥 Deletar subcoleções primeiro
    const subcollections = ["horarios", "eventos", "notificacoes"];

    for (const sub of subcollections) {
      const subRef = espRef.collection(sub);
      const snap = await subRef.get();

      const batch = db.batch();

      snap.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      if (!snap.empty) {
        await batch.commit();
        console.log(`✅ Subcoleção ${sub} apagada`);
      }
    }

    // Agora deleta o sensor
    await espRef.delete();

    console.log("✅ Sensor deletado completamente do Firebase");

    return res.status(200).json({
      message: "Sensor e subcoleções deletados com sucesso"
    });

  } catch (error) {
    console.error("Erro ao deletar sensor:", error);
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /esp/horarios/:uid/:mac/:horarioId
app.delete("/esp/horarios/:uid/:mac/:horarioId", async (req, res) => {
  const { uid, mac, horarioId } = req.params;

  try {
    const horarioRef = db
      .collection("users")
      .doc(uid)
      .collection("espDevices")
      .doc(mac)
      .collection("horarios")
      .doc(horarioId);

    const docSnap = await horarioRef.get();
    if (!docSnap.exists) return res.status(404).json({ error: "Horário não encontrado" });

    await horarioRef.delete();

    return res.status(200).json({ message: "Horário deletado com sucesso" });
  } catch (error) {
    console.error("Erro ao deletar horário:", error);
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /notificacao/:uid/:mac/:eventId
app.delete("/notificacao/:uid/:mac/:eventId", async (req, res) => {
  const { uid, mac, eventId } = req.params;

  try {
    const eventRef = db
      .collection("users")
      .doc(uid)
      .collection("espDevices")
      .doc(mac)
      .collection("events")
      .doc(eventId);

    const docSnap = await eventRef.get();
    if (!docSnap.exists) return res.status(404).json({ error: "Evento não encontrado" });

    await eventRef.delete();

    return res.status(200).json({ message: "Notificação deletada com sucesso" });
  } catch (error) {
    console.error("Erro ao deletar notificação:", error);
    return res.status(500).json({ error: error.message });
  }
});


// =======================
// Inicializar servidor
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
