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

// Referência ao Firestore
const db = admin.firestore();
const tokensCollection = db.collection('deviceTokens');

// ===============================
// Rotas
// ===============================

// Recebe token do app e salva
app.post('/register-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token não enviado' });

  try {
    // Salva no Firestore (doc com ID = token)
    await tokensCollection.doc(token).set({
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('Token registrado:', token);
    res.json({ message: 'Token registrado com sucesso' });
  } catch (err) {
    console.error('Erro ao registrar token:', err);
    res.status(500).json({ error: 'Falha ao registrar token' });
  }
});

// Recebe evento do ESP32 e envia notificação
app.post('/motion-detected', async (req, res) => {
  const { sensor } = req.body;
  if (!sensor) return res.status(400).json({ error: 'Sensor não informado' });

  console.log('Movimento detectado no sensor:', sensor);

  try {
    // Busca todos os tokens do Firestore
    const snapshot = await tokensCollection.get();
    if (snapshot.empty) {
      return res.status(400).json({ error: 'Nenhum token registrado' });
    }

    const tokens = snapshot.docs.map(doc => doc.id);

    const message = {
      notification: {
        title: 'Alerta de Movimento!',
        body: `Movimento detectado no sensor ${sensor}`
      },
      tokens: tokens
    };

    const response = await admin.messaging().sendMulticast(message);
    console.log('Notificação enviada:', response.successCount, 'sucessos');

    // Remove tokens inválidos
    response.responses.forEach((r, i) => {
      if (!r.success) {
        console.warn('Token inválido, removendo:', tokens[i]);
        tokensCollection.doc(tokens[i]).delete();
      }
    });

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
