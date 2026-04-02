require('dotenv').config();
const express = require('express');
const cors = require('cors');

const entreprisesRoutes = require('./routes/entreprises');
const hunterRoutes = require('./routes/hunter');
const statusRoutes = require('./routes/status');
const claudeRoutes = require('./routes/claude');
const exportsRoutes = require('./routes/exports');
const dropcontactRoutes = require('./routes/dropcontact');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.use('/api/status', statusRoutes);
app.use('/api/entreprises', entreprisesRoutes);
app.use('/api/hunter', hunterRoutes);
app.use('/api/claude', claudeRoutes);
app.use('/api/exports', exportsRoutes);
app.use('/api/dropcontact', dropcontactRoutes);

app.listen(PORT, () => {
  console.log(`Serveur backend démarré sur http://localhost:${PORT}`);
});
