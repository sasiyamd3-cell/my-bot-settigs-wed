import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const MONGO_URI = 'mongodb+srv://herovimuvimu_db_user:6aKwpHpZM34o2Kf0@cluster0.v4q1fn8.mongodb.net/MAIRADB';
const client = new MongoClient(MONGO_URI, { maxPoolSize: 5 });
let isDbConnected = false;

const baseDefaultSettings = {
    prefix: '.',
    name: '𝐌𝐈𝐘𝐎𝐑𝐀 𝐌𝐃 🌸',
    from: 'ꜱʀɪ ʟᴀɴᴋᴀ',
    mode: 'public',
    footer: '𝐌𝐈𝐘𝐎𝐑𝐀 𝐌𝐃 🌸 ᴛᴇᴄʜ',
    antidelete: false,
    antiedit: false,
    panelPassword: ''
};

async function getDb() {
    if (!isDbConnected) {
        await client.connect();
        isDbConnected = true;
    }
    return client.db('MAIRADB');
}

async function getSettingsCollection() {
    const db = await getDb();
    return db.collection('miyora_bot_settings');
}

async function getSessionCollections() {
    const db = await getDb();
    const cols = await db.listCollections().toArray();
    return cols
        .map((c) => c.name)
        .filter((name) => /^status_\d+$/.test(name) || name === 'textmini');
}

async function loadSessionSettings(ownerNumber) {
    const ownerKey = String(ownerNumber || '').replace(/\D/g, '') || String(ownerNumber || '').trim();
    let merged = { ...baseDefaultSettings };

    if (!ownerKey) return merged;

    try {
        const settingsCol = await getSettingsCollection();
        const saved = await settingsCol.findOne({ ownerNumber: ownerKey });
        if (saved && saved.settings) {
            merged = { ...baseDefaultSettings, ...saved.settings };
        }

        const gqPassCol = client.db('GQueen').collection('PASS');
        const passDoc = await gqPassCol.findOne({
            $or: [{ _id: ownerKey }, { _id: String(ownerNumber).trim() }]
        });

        if (passDoc?.password && merged.panelPassword !== String(passDoc.password)) {
            merged.panelPassword = String(passDoc.password);
            await settingsCol.updateOne(
                { ownerNumber: ownerKey },
                {
                    $set: {
                        ownerNumber: ownerKey,
                        'settings.panelPassword': merged.panelPassword,
                        updatedAt: new Date()
                    }
                },
                { upsert: true }
            );
        }
    } catch (err) {
        isDbConnected = false;
        console.error(`⚠️ loadSessionSettings error for ${ownerKey}:`, err.message || err);
    }

    return merged;
}

async function saveSessionSettings(ownerNumber, settingsObj) {
    const ownerKey = String(ownerNumber || '').replace(/\D/g, '') || String(ownerNumber || '').trim();
    const cleanData = {
        prefix: settingsObj.prefix || baseDefaultSettings.prefix,
        name: settingsObj.name || baseDefaultSettings.name,
        from: settingsObj.from || baseDefaultSettings.from,
        mode: settingsObj.mode || baseDefaultSettings.mode,
        footer: settingsObj.footer || baseDefaultSettings.footer,
        antidelete: Boolean(settingsObj.antidelete),
        antiedit: Boolean(settingsObj.antiedit),
        ...(settingsObj.logo ? { logo: settingsObj.logo } : {}),
        ...(settingsObj.panelPassword ? { panelPassword: String(settingsObj.panelPassword) } : {})
    };

    const settingsCol = await getSettingsCollection();
    await settingsCol.updateOne(
        { ownerNumber: ownerKey },
        {
            $set: {
                ownerNumber: ownerKey,
                settings: cleanData,
                updatedAt: new Date()
            }
        },
        { upsert: true }
    );

    return cleanData;
}

async function verifySessionAuth(req, ownerKey) {
    const providedPass = String(
        req.headers['x-panel-password'] ||
        req.body?.password ||
        req.query?.password ||
        ''
    ).trim();

    if (!providedPass) return false;
    const current = await loadSessionSettings(ownerKey);
    return Boolean(current.panelPassword && providedPass === String(current.panelPassword).trim());
}

app.use(express.json());
app.use(express.static(__dirname));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-panel-password');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.get('/api/sessions', async (req, res) => {
    try {
        const db = await getDb();
        const sessionCols = await getSessionCollections();
        const nums = new Set();

        for (const colName of sessionCols) {
            const docs = await db
                .collection(colName)
                .find({}, { projection: { ownerNumber: 1, _id: 0 } })
                .toArray();
            for (const d of docs) {
                const n = String(d.ownerNumber || '').replace(/\D/g, '');
                if (n) nums.add(n);
            }
        }

        const settingsDocs = await db
            .collection('miyora_bot_settings')
            .find({}, { projection: { ownerNumber: 1, _id: 0 } })
            .toArray();
        for (const s of settingsDocs) {
            const n = String(s.ownerNumber || '').replace(/\D/g, '');
            if (n) nums.add(n);
        }

        res.json({ ok: true, sessions: Array.from(nums) });
    } catch (err) {
        isDbConnected = false;
        console.error('[settings-web] /api/sessions error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const rawOwner = req.body?.ownerNumber || '';
        const ownerKey = String(rawOwner).replace(/\D/g, '') || String(rawOwner).trim();
        const password = String(req.body?.password || '').trim();

        if (!ownerKey || !password) {
            return res.status(400).json({ ok: false, error: 'Session number and password required' });
        }

        const current = await loadSessionSettings(ownerKey);
        if (!current.panelPassword || password !== String(current.panelPassword).trim()) {
            return res.status(401).json({ ok: false, error: 'Invalid session number or password' });
        }

        const { panelPassword, ...safeSettings } = current;
        res.json({ ok: true, ownerNumber: ownerKey, settings: safeSettings });
    } catch (err) {
        isDbConnected = false;
        console.error('[settings-web] /api/auth/login error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.get('/api/settings/:ownerNumber', async (req, res) => {
    try {
        const ownerKey =
            String(req.params.ownerNumber || '').replace(/\D/g, '') ||
            String(req.params.ownerNumber || '').trim();

        if (!ownerKey) {
            return res.status(400).json({ ok: false, error: 'Invalid session number' });
        }

        const authed = await verifySessionAuth(req, ownerKey);
        if (!authed) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        const current = await loadSessionSettings(ownerKey);
        const { panelPassword, ...safeSettings } = current;
        res.json({ ok: true, ownerNumber: ownerKey, settings: safeSettings });
    } catch (err) {
        isDbConnected = false;
        console.error('[settings-web] GET /api/settings error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/api/settings/:ownerNumber', async (req, res) => {
    try {
        const ownerKey =
            String(req.params.ownerNumber || '').replace(/\D/g, '') ||
            String(req.params.ownerNumber || '').trim();

        if (!ownerKey) {
            return res.status(400).json({ ok: false, error: 'Invalid session number' });
        }

        const authed = await verifySessionAuth(req, ownerKey);
        if (!authed) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        const existing = await loadSessionSettings(ownerKey);
        const body = req.body || {};

        const nextSettings = {
            ...existing,
            prefix: typeof body.prefix === 'string' && body.prefix.trim() ? body.prefix.trim() : existing.prefix,
            name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name,
            mode: body.mode === 'private' || body.mode === 'public' ? body.mode : existing.mode,
            logo: typeof body.logo === 'string' ? body.logo.trim() : (existing.logo || ''),
            antidelete: typeof body.antidelete === 'boolean' ? body.antidelete : Boolean(existing.antidelete),
            antiedit: typeof body.antiedit === 'boolean' ? body.antiedit : Boolean(existing.antiedit)
        };

        if (!nextSettings.logo) {
            delete nextSettings.logo;
        }

        const savedClean = await saveSessionSettings(ownerKey, nextSettings);
        const { panelPassword, ...safeSettings } = savedClean;

        res.json({ ok: true, ownerNumber: ownerKey, settings: safeSettings });
    } catch (err) {
        isDbConnected = false;
        console.error('[settings-web] POST /api/settings error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`⚙️ MIYORA MD Settings Web running on port ${PORT}`);
});
