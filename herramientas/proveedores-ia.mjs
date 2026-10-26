// herramientas/proveedores-ia.mjs — Las IA que puede usar el bot (nodo "IA balanceada" del flujo de n8n).
// Todas hablan la API de OpenAI (/chat/completions) y sirven modelos abiertos (DeepSeek, Llama, Qwen, Mistral) o
// tienen una cuota gratuita alta. El bot reparte las consultas según el PESO (≈ consultas gratis por día): va primero
// la que menos uso lleva hoy en proporción a su peso, y si una falla pasa a la siguiente.
//
// Para activar una: crea la clave en su página (registro) y ponla en .env con su nombre (claveEnv). Luego:
//   node herramientas/configurar-ias.mjs            → prueba cada clave y elige el modelo (no cambia nada)
//   node herramientas/configurar-ias.mjs --aplicar  → guarda el modelo elegido en .env (IA_<ID>_MODELO)
//   node herramientas/sincronizar-n8n.mjs --aplicar → lleva las claves al nodo de tu n8n (nunca a git)
// SiliconFlow: siempre la dirección internacional (.com); la .cn de SILICONFLOW_BASE_URL es de cuentas de China.
// Para apagar una sin borrar su clave: IA_<ID>_APAGADA=1 en .env. Para cambiar su peso: IA_<ID>_PESO=…

export const PROVEEDORES_IA = [
    { id: 'GROQ', nombre: 'Groq', url: 'https://api.groq.com/openai/v1', claveEnv: 'IA_GROQ_KEY', peso: 1000, limite: 7800, maxTokens: 900, extra: { reasoning_effort: 'low' }, // gratis: 8.000 tokens/min por consulta
        modelo: 'openai/gpt-oss-120b', preferir: [/gpt-oss-120b/i, /qwen\/qwen3/i, /llama-3\.3-70b/i, /llama-4/i],
        registro: 'https://console.groq.com/keys', nota: 'gratis, muy rápido (GPT-OSS 120B, Qwen 3)' },
    { id: 'CEREBRAS', nombre: 'Cerebras', url: 'https://api.cerebras.ai/v1', claveEnv: 'IA_CEREBRAS_KEY', peso: 1000,
        modelo: 'llama-3.3-70b', preferir: [/llama-3\.3-70b/i, /qwen-?3/i, /gpt-oss/i, /llama/i],
        registro: 'https://cloud.cerebras.ai', nota: 'gratis, ~1 millón de tokens por día' },
    { id: 'MISTRAL', nombre: 'Mistral', url: 'https://api.mistral.ai/v1', claveEnv: 'IA_MISTRAL_KEY', peso: 1000,
        modelo: 'mistral-small-latest', preferir: [/^mistral-small-latest$/i, /^mistral-medium-latest$/i, /^open-mistral/i],
        registro: 'https://console.mistral.ai/api-keys', nota: 'plan gratuito "Experiment" (modelos abiertos de Mistral)' },
    { id: 'SILICONFLOW', nombre: 'SiliconFlow', url: 'https://api.siliconflow.com/v1', claveEnv: 'SILICONFLOW_API_KEY', peso: 1000,
        modelo: 'deepseek-ai/DeepSeek-V3', preferir: [/deepseek-ai\/DeepSeek-V3$/i, /DeepSeek-V3/i, /Qwen2\.5-72B/i],
        registro: 'https://cloud.siliconflow.com', nota: 'de pago por uso (DeepSeek-V3)' },
    { id: 'NVIDIA', nombre: 'NVIDIA NIM', url: 'https://integrate.api.nvidia.com/v1', claveEnv: 'IA_NVIDIA_KEY', peso: 500,
        modelo: 'nvidia/nemotron-3-super-120b-a12b', preferir: [/^nvidia\/nemotron-3-super-120b/i, /mistral-large-2/i, /gpt-oss-20b/i],
        registro: 'https://build.nvidia.com', nota: 'créditos gratis (Nemotron 120B, Mistral Large, GPT-OSS); su DeepSeek es muy lento' },
    { id: 'GEMINI', nombre: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', urlEnv: 'IA_RESPALDO_URL', claveEnv: 'IA_RESPALDO_KEY', modeloEnv: 'IA_RESPALDO_MODELO', peso: 500,
        modelo: 'gemini-3.5-flash-lite', preferir: [/flash-lite$/i, /flash$/i],
        registro: 'https://aistudio.google.com/apikey', nota: 'nivel gratuito de Google (no es abierto)' },
    // Google da cuota diaria POR MODELO: la misma clave con otro modelo suma cupo gratis (y sirve si uno está saturado)
    { id: 'GEMINI_LITE_ANTERIOR', nombre: 'Gemini Lite 3.1', url: 'https://generativelanguage.googleapis.com/v1beta/openai', urlEnv: 'IA_RESPALDO_URL', claveEnv: 'IA_RESPALDO_KEY', peso: 250,
        modelo: 'gemini-3.1-flash-lite', preferir: [/^gemini-3\.1-flash-lite$/i],
        registro: 'https://aistudio.google.com/apikey', nota: 'misma clave de Gemini; sirve cuando el modelo nuevo está saturado (503)' },
    // Otro modelo con la MISMA clave de Gemini: Google da cuota gratuita diaria aparte por modelo
    { id: 'GEMINI_FLASH', nombre: 'Gemini Flash', url: 'https://generativelanguage.googleapis.com/v1beta/openai', urlEnv: 'IA_RESPALDO_URL', claveEnv: 'IA_RESPALDO_KEY', peso: 250,
        modelo: 'gemini-2.5-flash', preferir: [/^gemini-[\d.]+-flash$/i, /^gemini-flash-latest$/i, /^gemini-2\.5-flash$/i],
        registro: 'https://aistudio.google.com/apikey', nota: 'misma clave de Gemini; cupo diario aparte' },
    { id: 'SAMBANOVA', nombre: 'SambaNova', url: 'https://api.sambanova.ai/v1', claveEnv: 'IA_SAMBANOVA_KEY', peso: 300,
        modelo: 'Meta-Llama-3.3-70B-Instruct', preferir: [/DeepSeek-V3/i, /gpt-oss-120b/i, /Llama-3\.3-70B/i, /Llama-4/i],
        registro: 'https://cloud.sambanova.ai/apis', nota: 'gratis, muy rápido (Llama 70B, DeepSeek)' },
    { id: 'TOGETHER', nombre: 'Together', url: 'https://api.together.xyz/v1', claveEnv: 'IA_TOGETHER_KEY', peso: 100,
        modelo: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free', preferir: [/-Free$/i],
        registro: 'https://api.together.ai/settings/api-keys', nota: 'modelos «-Free» sin costo (cupo por minuto bajo)' },
    { id: 'COHERE', nombre: 'Cohere', url: 'https://api.cohere.ai/compatibility/v1', claveEnv: 'IA_COHERE_KEY', peso: 30,
        modelo: 'command-a-03-2025', preferir: [/^command-a/i, /^command-r-plus/i, /^command-r/i],
        registro: 'https://dashboard.cohere.com/api-keys', nota: 'clave de prueba gratis (≈ 1.000 consultas al mes)' },
    { id: 'HUGGINGFACE', nombre: 'Hugging Face', url: 'https://router.huggingface.co/v1', claveEnv: 'IA_HUGGINGFACE_KEY', peso: 30,
        modelo: 'openai/gpt-oss-120b', preferir: [/gpt-oss-120b/i, /Llama-3\.3-70B/i, /Qwen/i],
        registro: 'https://huggingface.co/settings/tokens (token de lectura con «Inference Providers»)', nota: 'créditos gratis mensuales pequeños' },
    // Alibaba Model Studio (internacional, Singapur): API Key «sk-…» de Model Studio, NUNCA la AccessKey de la cuenta (RAM)
    { id: 'ALIBABA', nombre: 'Alibaba Qwen', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', urlEnv: 'IA_ALIBABA_URL', claveEnv: 'IA_ALIBABA_KEY', peso: 300,
        modelo: 'qwen3.7-flash', preferir: [/^qwen3\.\d-flash$/i, /^qwen3\.\d-plus$/i, /^deepseek-v4\.1-flash$/i, /^qwen3\.\d-max$/i],
        registro: 'https://modelstudio.console.alibabacloud.com (región Singapur → API Key)', nota: 'cupo gratis para cuentas nuevas (Qwen)' },
    // Gizmo: agregador compatible con OpenAI (cientos de modelos). Su chat no acepta herramientas (modo Agent): ahí se salta solo
    { id: 'GIZMO_GRATIS', nombre: 'Gizmo gratis', url: 'https://api.gizmoplatforms.com/api/v1', claveEnv: 'GIZMO_API_KEY', peso: 300,
        modelo: 'nvidia/nemotron-3-ultra-550b-a55b:free', preferir: [/nemotron-3-ultra.*:free$/i, /:free$/i],
        registro: 'https://api.gizmoplatforms.com', nota: 'modelos «:free» del agregador Gizmo' },
    { id: 'GIZMO', nombre: 'Gizmo DeepSeek', url: 'https://api.gizmoplatforms.com/api/v1', claveEnv: 'GIZMO_API_KEY', peso: 100,
        modelo: 'deepseek/deepseek-v4.1-flash', preferir: [/deepseek-v4\.1-flash$/i, /deepseek-v4-flash$/i, /deepseek-v3\.2$/i],
        registro: 'https://api.gizmoplatforms.com', nota: 'DeepSeek V4.1 Flash (puede consumir créditos de Gizmo)' },
    { id: 'OPENROUTER', nombre: 'OpenRouter', url: 'https://openrouter.ai/api/v1', claveEnv: 'IA_OPENROUTER_KEY', peso: 50,
        modelo: 'nvidia/nemotron-3-super-120b-a12b:free', preferir: [/nemotron-3-super.*:free$/i, /gemma-4-31b.*:free$/i, /deepseek.*:free$/i, /llama.*70b.*:free$/i],
        registro: 'https://openrouter.ai/keys', nota: 'modelos ":free" (50 consultas/día; 1000 si cargas US$10 una vez)' },
    { id: 'OPENAI', nombre: 'OpenAI', url: 'https://api.openai.com/v1', claveEnv: 'IA_OPENAI_KEY', claveAlt: 'OPENAI_API_KEY', peso: 200,
        modelo: 'gpt-4o-mini', preferir: [/^gpt-5-mini$/i, /^gpt-4.1-mini$/i, /^gpt-4o-mini$/i],
        registro: 'https://platform.openai.com/api-keys', nota: 'de pago por uso (no es abierto)' },
    // Modelo en tu PC (Ollama, LM Studio, vLLM…), sin clave: se activa con IA_LOCAL_URL (Ollama: http://localhost:11434/v1;
    // LM Studio: http://localhost:1234/v1; si n8n corre en Docker: http://host.docker.internal:11434/v1) e IA_LOCAL_MODELO
    { id: 'LOCAL', nombre: 'IA local', url: 'http://localhost:11434/v1', urlEnv: 'IA_LOCAL_URL', claveEnv: 'IA_LOCAL_KEY', sinClave: true, modeloEnv: 'IA_LOCAL_MODELO', peso: 100,
        modelo: 'qwen2.5:7b', preferir: [/qwen/i, /llama/i, /gemma/i, /mistral/i],
        registro: 'https://ollama.com/download (luego: ollama pull qwen2.5:7b)', nota: 'gratis y sin internet; tan rápida como tu PC' },
    { id: 'GITHUB', nombre: 'GitHub Models', url: 'https://models.github.ai/inference', claveEnv: 'IA_GITHUB_KEY', peso: 50,
        modelo: 'deepseek/DeepSeek-V3-0324', preferir: [/deepseek.*v3/i, /llama-3\.3-70b/i],
        registro: 'https://github.com/settings/tokens (token con permiso models:read)', nota: 'gratis con tu cuenta de GitHub, cupo bajo' },
];

// Lista para el nodo de n8n: solo las que tienen clave y no están apagadas
export const claveDe = (p, env) => String(env[p.claveEnv] || (p.claveAlt && env[p.claveAlt]) || '').trim();
export const activa = (p, env) => (p.sinClave ? !!String(env[p.urlEnv] ?? '').trim() : !!claveDe(p, env));
export function armarProveedores(env) {
    return PROVEEDORES_IA.filter((p) => activa(p, env) && !/^(1|si|sí|true)$/i.test(String(env[`IA_${p.id}_APAGADA`] ?? '')))
        .map((p) => ({
            nombre: p.nombre,
            url: String((p.urlEnv && env[p.urlEnv]) || p.url).trim().replace(/\/+$/, ''),
            modelo: String((p.modeloEnv && env[p.modeloEnv]) || env[`IA_${p.id}_MODELO`] || p.modelo).trim(),
            clave: claveDe(p, env) || 'local',
            peso: Number(env[`IA_${p.id}_PESO`]) > 0 ? Number(env[`IA_${p.id}_PESO`]) : p.peso,
            ...(p.limite ? { limite: p.limite } : {}), ...(p.maxTokens ? { maxTokens: p.maxTokens } : {}), ...(p.extra ? { extra: p.extra } : {}),
        }));
}

export const MARCA_CLAVES = '[] /*__CLAVES_IA__*/';
// Pone las claves en el código del nodo (solo al escribir en tu n8n; el flujo de git queda con la lista vacía)
export const conClaves = (jsCode, lista) => String(jsCode).split(MARCA_CLAVES).join(`${JSON.stringify(lista)} /*__CLAVES_IA__*/`);
