const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Inicializa Firebase Admin usando variável de ambiente
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

console.log('Firebase Admin inicializado');

const db = admin.firestore();

// ===============================
// Rotas
// ===============================

// 1. Registrar token FCM para usuário
app.post('/register-token', async (req, res) => {
  const { userId, token } = req.body;

  if (!userId || !token) {
    return res.status(400).json({ error: 'userId e token são obrigatórios' });
  }

  try {
    const userRef = db.collection('users').doc(userId);

    await userRef.set({
      token,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`Token registrado: ${token} para usuário ${userId}`);
    res.json({ message: 'Token registrado com sucesso' });
  } catch (err) {
    console.error('Erro ao registrar token:', err);
    res.status(500).json({ error: 'Falha ao registrar token' });
  }
});

// 2. Recebe evento do ESP32 e envia notificação
app.post('/motion-detected', async (req, res) => {
  const { userId, sensorId } = req.body;

  if (!userId || !sensorId) {
    return res.status(400).json({ error: 'userId e sensorId são obrigatórios' });
  }

  console.log('Movimento detectado no sensor:', sensorId, 'usuário:', userId);

  try {
    console.log('Verificando usuário no Firestore:', userId);

    const userDoc = await db.collection('users').doc(userId).get();

    console.log('Documento encontrado?', userDoc.exists);

    if (!userDoc.exists) {
      return res.status(400).json({ error: 'Usuário não encontrado' });
    }

    const token = userDoc.data().token;

    if (!token) {
      return res.status(400).json({ error: 'Nenhum token registrado para esse usuário' });
    }

    const message = {
      notification: {
        title: 'Alerta de Movimento!',
        body: `Movimento detectado no sensor ${sensorId}`
      },
      token: token
    };

    const response = await admin.messaging().send(message);
    console.log('Notificação enviada com sucesso:', response);

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao enviar notificação:', err);
    res.status(500).json({ error: 'Falha ao enviar notificação' });
  }
});

// Rota teste
app.get('/', (req, res) => {
  res.send('Backend do Alerta Seguro funcionando!');
});

// Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
