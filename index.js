const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Inicializa Firebase Admin usando variável de ambiente
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Ajuste para corrigir o private_key no formato PEM
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

console.log('Firebase Admin inicializado');

const db = admin.firestore();

// ===============================
// Rotas
// ===============================

// Registra token FCM para sensor específico
app.post('/register-token', async (req, res) => {
  const { userId, sensorId, token } = req.body;

  if (!userId || !sensorId || !token) {
    return res.status(400).json({ error: 'userId, sensorId e token são obrigatórios' });
  }

  try {
    const tokenRef = db.collection('users').doc(userId).collection('sensors').doc(sensorId);
    await tokenRef.set({
      token,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`Token registrado: ${token} para usuário ${userId}, sensor ${sensorId}`);
    res.json({ message: 'Token registrado com sucesso' });
  } catch (err) {
    console.error('Erro ao registrar token:', err);
    res.status(500).json({ error: 'Falha ao registrar token' });
  }
});

// Recebe evento do ESP32 e envia notificação
app.post('/motion-detected', async (req, res) => {
  const { userId, sensorId } = req.body;

  if (!userId || !sensorId) {
    return res.status(400).json({ error: 'userId e sensorId são obrigatórios' });
  }

  console.log('Movimento detectado no sensor:', sensorId, 'usuário:', userId);

  try {
    const tokenDoc = await db.collection('users').doc(userId).collection('sensors').doc(sensorId).get();

    if (!tokenDoc.exists) {
      return res.status(400).json({ error: 'Nenhum token registrado para esse sensor' });
    }

    const token = tokenDoc.data().token;

    const message = {
      notification: {
        title: 'Alerta de Movimento!',
        body: `Movimento detectado no sensor ${sensorId}`
      },
      token: token
    };

    const response = await admin.messaging().send(message);
    console.log('Notificação enviada com sucesso');

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao enviar notificação:', err);
    res.status(500).json({ error: 'Falha ao enviar notificação' });
  }
});

// Teste de rota
app.get('/', (req, res) => {
  res.send('Backend do Alerta Seguro funcionando!');
});

// Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
