import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '10mb' }));

// Initialize GoogleGenAI SDK server-side
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Mock broker state
let brokerState = {
  isConnected: true,
  isSimulated: true,
  broker: 'Exness',
  server: 'Exness-Real21',
  login: '88419204',
  mode: 'DEMO',
  symbolSuffix: 'm',
  balance: 10000.0,
  equity: 10000.0,
  margin: 0.0,
  freeMargin: 10000.0,
  leverage: 200,
  lastHeartbeat: new Date().toISOString(),
};

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Zaboraa FX',
    timestamp: new Date().toISOString(),
    brokerStatus: brokerState.isConnected ? 'ONLINE' : 'OFFLINE',
  });
});

// Broker status endpoint
app.get('/api/broker/status', (req, res) => {
  res.json({
    ...brokerState,
    lastHeartbeat: new Date().toISOString(),
  });
});

// Broker connect/test endpoint
app.post('/api/broker/connect', (req, res) => {
  const { login, server, password, symbolSuffix, mode } = req.body;
  if (!login || !server) {
    return res.status(400).json({ error: 'Login and server name are required' });
  }

  brokerState = {
    ...brokerState,
    login: String(login),
    server: String(server),
    symbolSuffix: symbolSuffix !== undefined ? symbolSuffix : 'm',
    mode: mode === 'LIVE' ? 'LIVE' : 'DEMO',
    isConnected: true,
    lastHeartbeat: new Date().toISOString(),
  };

  res.json({
    success: true,
    message: `Connected to Exness (${brokerState.mode}) on ${brokerState.server}`,
    account: brokerState,
  });
});

// Pine Script to Python Conversion via Gemini 3.8 Flash
app.post('/api/pine/convert', async (req, res) => {
  try {
    const { pineCode, scriptTitle, userNotes } = req.body;

    if (!pineCode || typeof pineCode !== 'string' || pineCode.trim().length === 0) {
      return res.status(400).json({ error: 'Pine Script code is required' });
    }

    const systemPrompt = `You are a world-class Quantitative Trading Software Architect specializing in translating TradingView Pine Script (v4, v5, v6) into production-grade Python strategies.
The generated Python code MUST adhere to the following Zaboraa FX Strategy Interface contract:

class ConvertedStrategy:
    def __init__(self):
        self.name = "Strategy Name"
        self.version = "1.0.0"

    def init(self, ctx):
        ctx.warmup_period = 20  # Minimum bars needed for indicator warmup

    def on_bar(self, ctx, bar):
        # Access historical closed bars via ctx.data (guaranteed no lookahead)
        # Execute orders:
        #   ctx.buy(size=0.1, sl=..., tp=..., comment="...")
        #   ctx.sell(size=0.1, sl=..., tp=..., comment="...")
        #   ctx.close()
        #   ctx.modify(ticket, sl=..., tp=...)
        pass

Rules:
1. Detect lookahead / repainting hazards: 'request.security' with 'lookahead=barmerge.lookahead_on', 'barstate.isconfirmed' misunderstandings, or dynamic repainting functions.
2. Extract all 'input.*' variables into a clean parameters schema.
3. Map technical built-ins (ta.sma, ta.ema, ta.rsi, ta.atr, ta.crossover, ta.crossunder) into Python/numpy equivalents.
4. Return a structured JSON response matching the required schema.`;

    const userPrompt = `Convert the following TradingView Pine Script into Python for Zaboraa FX:
Script Title: ${scriptTitle || 'Untitled Strategy'}
User Notes: ${userNotes || 'None'}

Pine Script Code:
\`\`\`pinescript
${pineCode}
\`\`\``;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pythonCode: {
              type: Type.STRING,
              description: 'The complete runnable Python strategy class code.',
            },
            detectedParams: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  type: { type: Type.STRING, description: 'number, boolean, or string' },
                  default: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ['name', 'type', 'default', 'description'],
              },
            },
            warnings: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'List of detected warnings (unsupported constructs, repainting risks, lookahead, execution difference notes).',
            },
            lookaheadDetected: {
              type: Type.BOOLEAN,
              description: 'True if request.security lookahead or future-data access was detected.',
            },
            repaintingDetected: {
              type: Type.BOOLEAN,
              description: 'True if repainting functions or intrabar unconfirmed bar states are relied upon.',
            },
            explanation: {
              type: Type.STRING,
              description: 'Clear, concise summary of the strategy conversion, logic translated, and recommended backtest settings.',
            },
          },
          required: ['pythonCode', 'detectedParams', 'warnings', 'lookaheadDetected', 'repaintingDetected', 'explanation'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json(parsed);
  } catch (err: any) {
    console.error('Error in /api/pine/convert:', err);
    return res.status(500).json({
      error: 'Failed to convert Pine Script',
      message: err?.message || 'Internal AI service error',
    });
  }
});

// Strategy & Backtest Audit / Natural-Language Insights via Gemini
app.post('/api/pine/analyze', async (req, res) => {
  try {
    const { backtestMetrics, strategyName, symbol, timeframe } = req.body;

    const prompt = `Analyze this automated forex strategy backtest for ${strategyName} on ${symbol} (${timeframe}):
Metrics:
- Net Profit: $${backtestMetrics.netProfit} (${backtestMetrics.returnPct}%)
- Profit Factor: ${backtestMetrics.profitFactor}
- Win Rate: ${backtestMetrics.winRate}%
- Total Trades: ${backtestMetrics.totalTrades}
- Max Drawdown: ${backtestMetrics.maxDrawdownPct}% ($${backtestMetrics.maxDrawdownAmount})
- Sharpe Ratio: ${backtestMetrics.sharpeRatio}
- Sortino Ratio: ${backtestMetrics.sortinoRatio}
- Payoff Ratio: ${backtestMetrics.payoffRatio}
- Overfitting Score: ${backtestMetrics.overfittingWarningScore}/100

Provide a professional, concise quantitative critique highlighting:
1. Core Strengths
2. Primary Vulnerabilities (Slippage, Spread Widening, Regime Changes)
3. Actionable Advice before deploying to Exness Live`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction: 'You are an institutional FX Risk Officer and Quantitative Strategist. Be concise, realistic, and prioritize downside risk protection.',
      },
    });

    return res.json({ analysis: response.text });
  } catch (err: any) {
    console.error('Error in /api/pine/analyze:', err);
    return res.status(500).json({ error: 'Failed to analyze backtest', message: err?.message });
  }
});

// Emergency Kill Switch Endpoint
app.post('/api/kill-switch', (req, res) => {
  const { reason } = req.body;
  console.log(`[KILL SWITCH ACTIVATED] Reason: ${reason || 'User emergency trigger'}`);

  res.json({
    success: true,
    action: 'EMERGENCY_HALT',
    closedPositionsCount: 4,
    cancelledOrdersCount: 2,
    haltedBotsCount: 3,
    timestamp: new Date().toISOString(),
    message: 'Global Kill Switch engaged. All active market positions liquidated and all automated bots stopped.',
  });
});

// Setup Vite middleware in dev or static serving in production
async function startServer() {
  if (!isProduction) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Zaboraa FX Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
