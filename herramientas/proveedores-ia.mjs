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
    { id: 'GROQ', nombre: 'Groq', url: 'https://api.groq.com/openai/v1', claveEnv: 'IA_GROQ_KEY', peso: 1000,
        modelo: 'llama-3.3-70b-versatile', preferir: [/llama-3\.3-70b/i, /qwen.*32b/i, /gpt-oss-120b/i, /llama/i],
        registro: 'https://console.groq.com/keys', nota: 'gratis, muy rápido (Llama 3.3 70B, Qwen)' },
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
        modelo: 'deepseek-ai/deepseek-v3.1', preferir: [/deepseek-v3/i, /llama-3\.3-70b/i, /qwen/i],
        registro: 'https://build.nvidia.com', nota: 'créditos gratis (DeepSeek, Llama, Qwen)' },
    { id: 'GEMINI', nombre: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', urlEnv: 'IA_RESPALDO_URL', claveEnv: 'IA_RESPALDO_KEY', modeloEnv: 'IA_RESPALDO_MODELO', peso: 500,
        modelo: 'gemini-3.5-flash-lite', preferir: [/flash-lite$/i, /flash$/i],
        registro: 'https://aistudio.google.com/apikey', nota: 'nivel gratuito de Google (no es abierto)' },
    // Google da cuota diaria POR MODELO: la misma clave con otro modelo suma cupo gratis (y sirve si uno está saturado)
    { id: 'GEMINI_LITE_ANTERIOR', nombre: 'Gemini Lite 3.1', url: 'https://generativelanguage.googleapis.com/v1beta/openai', urlEnv: 'IA_RESPALDO_URL', claveEnv: 'IA_RESPALDO_KEY', peso: 250,
        modelo: 'gemini-3.1-flash-lite', preferir: [/^gemini-3\.1-flash-lite$/i],
        registro: 'https://aistudio.google.com/apikey', nota: 'misma clave de Gemini; sirve cuando el modelo nuevo está saturado (503)' },
    { id: 'OPENROUTER', nombre: 'OpenRouter', url: 'https://openrouter.ai/api/v1', claveEnv: 'IA_OPENROUTER_KEY', peso: 50,
        modelo: 'deepseek/deepseek-chat-v3-0324:free', preferir: [/deepseek.*chat.*:free$/i, /deepseek.*:free$/i, /llama-3\.3-70b.*:free$/i, /qwen.*:free$/i],
        registro: 'https://openrouter.ai/keys', nota: 'modelos ":free" (50 consultas/día; 1000 si cargas US$10 una vez)' },
    { id: 'GITHUB', nombre: 'GitHub Models', url: 'https://models.github.ai/inference', claveEnv: 'IA_GITHUB_KEY', peso: 50,
        modelo: 'deepseek/DeepSeek-V3-0324', preferir: [/deepseek.*v3/i, /llama-3\.3-70b/i],
        registro: 'https://github.com/settings/tokens (token con permiso models:read)', nota: 'gratis con tu cuenta de GitHub, cupo bajo' },
];

// Lista para el nodo de n8n: solo las que tienen clave y no están apagadas
export function armarProveedores(env) {
    return PROVEEDORES_IA.filter((p) => String(env[p.claveEnv] ?? '').trim() && !/^(1|si|sí|true)$/i.test(String(env[`IA_${p.id}_APAGADA`] ?? '')))
        .map((p) => ({
            nombre: p.nombre,
            url: String((p.urlEnv && env[p.urlEnv]) || p.url).trim().replace(/\/+$/, ''),
            modelo: String((p.modeloEnv && env[p.modeloEnv]) || env[`IA_${p.id}_MODELO`] || p.modelo).trim(),
            clave: String(env[p.claveEnv]).trim(),
            peso: Number(env[`IA_${p.id}_PESO`]) > 0 ? Number(env[`IA_${p.id}_PESO`]) : p.peso,
        }));
}

export const MARCA_CLAVES = '[] /*__CLAVES_IA__*/';
// Pone las claves en el código del nodo (solo al escribir en tu n8n; el flujo de git queda con la lista vacía)
export const conClaves = (jsCode, lista) => String(jsCode).split(MARCA_CLAVES).join(`${JSON.stringify(lista)} /*__CLAVES_IA__*/`);
