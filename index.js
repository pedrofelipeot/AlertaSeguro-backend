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

// Banco simples em memória para tokens (pode depois migrar para Firestore)
let tokens = [];

// ===============================
// Rotas
// ===============================

// Recebe token do app e salva
app.post('/register-token', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token não enviado' });

  if (!tokens.includes(token)) {
    tokens.push(token);
    console.log('Token registrado:', token);
  }

  res.json({ message: 'Token registrado com sucesso' });
});

// Recebe evento do ESP32 e envia notificação
app.post('/motion-detected', async (req, res) => {
  const { sensor } = req.body;
  if (!sensor) return res.status(400).json({ error: 'Sensor não informado' });

  console.log('Movimento detectado no sensor:', sensor);

  if (tokens.length === 0) {
    return res.status(400).json({ error: 'Nenhum token registrado' });
  }

  const message = {
    notification: {
      title: 'Alerta de Movimento!',
      body: `Movimento detectado no sensor ${sensor}`
    },
    tokens: tokens
  };

  try {
    const response = await admin.messaging().sendMulticast(message);
    console.log('Notificação enviada:', response.successCount, 'sucessos');
    res.json({ success: true, sent: response.successCount });
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
