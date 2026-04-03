require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const entreprisesRoutes = require('./routes/entreprises');
const hunterRoutes = require('./routes/hunter');
const statusRoutes = require('./routes/status');
const claudeRoutes = require('./routes/claude');
const exportsRoutes = require('./routes/exports');
const dropcontactRoutes = require('./routes/dropcontact');

const app = express();
const PORT = process.env.PORT || 3001;

// En production (build), on sert le frontend depuis backend/public
// En dev, le frontend tourne sur Vite (port 5173)
const isProd = process.env.NODE_ENV === 'production';

app.use(cors({ origin: isProd ? false : 'http://localhost:5173' }));
app.use(express.json());

app.use('/api/status', statusRoutes);
app.use('/api/entreprises', entreprisesRoutes);
app.use('/api/hunter', hunterRoutes);
app.use('/api/claude', claudeRoutes);
app.use('/api/exports', exportsRoutes);
app.use('/api/dropcontact', dropcontactRoutes);

// Servir le frontend buildé en production
if (isProd) {
  const frontendDist = path.join(__dirname, 'public');
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
  if (isProd) console.log(`Ouvre http://localhost:${PORT} dans ton navigateur`);
});
