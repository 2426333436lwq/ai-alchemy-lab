// 扫描 articles/ 下的 md，抓出长文生成时容易混进来的脏字符与英文残词。
// 用法：node .workbuddy/scripts/md-junk-scan.js [文件名关键字]
const fs = require("fs");
const path = require("path");

const DIR = path.resolve(__dirname, "..", "..", "articles");
const filter = process.argv[2] || "";

// 正文里允许出现的英文（不含代码块，代码块会整段跳过）
const WHITELIST = new Set([
  "GitHub", "Docker", "Nginx", "Prometheus", "Grafana", "systemd", "Linux",
  "Ollama", "ollama", "vLLM", "vllm", "SGLang", "LMDeploy", "llama", "cpp",
  "TensorRT", "TGI", "TurboMind", "MLX", "LoRA", "RAG", "Agent", "agents",
  "GPU", "CPU", "VRAM", "RAM", "KV", "cache", "caching", "token", "tokens",
  "GiB", "MiB", "KiB", "GB", "MB", "KB", "bit", "bits", "bpw", "ms", "tok",
  "CUDA", "Metal", "Vulkan", "SYCL", "HIP", "OpenCL", "WebGPU", "ROCm", "NPU",
  "AVX", "AVX512", "NEON", "PyTorch", "Python", "python", "JSON", "json",
  "Apache", "MIT", "LICENSE", "chat", "serving", "ID", "URL", "url",
  "PagedAttention", "RadixAttention", "FFN", "LRU", "INT", "INT4", "INT8",
  "FP", "FP4", "FP8", "FP16", "BF16", "NVFP4", "MXFP4", "AWQ", "GPTQ", "EXL2",
  "NF4", "W4A16", "W8A8", "E4M3", "E5M2", "E2M1", "SSE", "API", "api",
  "GGUF", "GGML", "imatrix", "Modelfile", "PARAMETER", "TEMPLATE", "SYSTEM",
  "sharegpt", "dataset", "path", "request", "rate", "graduate",
  // 包名 / 型号 / 文档里必然会出现的专有名词
  "Qwen", "MiMo", "GLM", "Kimi", "MiniMax", "DeepSeek", "Grok", "Gemini",
  "Llama", "Mistral", "Hugging", "Face", "perplexity", "Hessian", "ShareGPT", "Hopper", "Ada", "Blackwell", "Windows", "macOS", "Apple", "Silicon", "root", "config", "Mac", "MoE", "Apache", "llamacpp", "Artefact", "nvidia-smi", "OpenAI", "Releases", "release",
  "Dockerfile", "QLoRA", "TensorRT-LLM", "K-quant", "head_dim", "prefill",
  "cuBLAS", "cuDNN", "Max", "Studio", "Basic", "Auth", "Flash", "Attention",
  "embedding", "bug", "tag", "tags", "title", "summary", "cover",
  "scale", "tensor", "query", "batch", "deny", "schema", "usage", "prompt",
  "radix", "tree", "benchmark", "reuse", "per", "weight", "base", "key",
]);

const JUNK_RULES = [
  { name: "非目标语言字符", re: /[\u2581-\u259f\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af\u0400-\u04ff\u0e00-\u0e7f\u0600-\u06ff]/ },
  { name: "繁体混入", re: /起來|這個|什麼|裡|為了|設備|顯示|軟體|檔案|我們/ },
  { name: "占位串", re: /placeholder|lorem|TODO|FIXME|undefined|None\b/i },
];

let problems = 0;
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".md") && f.includes(filter));

for (const file of files) {
  const rawLines = fs.readFileSync(path.join(DIR, file), "utf8").split("\n");
  // 跳过 frontmatter
  let start = 0;
  if (rawLines[0] && rawLines[0].trim() === "---") {
    const end = rawLines.indexOf("---", 1);
    if (end > 0) start = end + 1;
  }
  let inFence = false;
  const lines = rawLines.slice(start);
  lines.forEach((raw, i) => {
    const lineNo = i + 1 + start;
    if (/^\s*```/.test(raw)) { inFence = !inFence; return; }
    if (inFence) return;
    const line = raw.trim();

    for (const rule of JUNK_RULES) {
      if (rule.re.test(line)) {
        console.log(`[${rule.name}] ${file}:${lineNo}\n    ${line.slice(0, 90)}`);
        problems++;
      }
    }

    // 去掉反引号包裹的术语后再提取英文词残留
    const prose = line.replace(/`[^`]*`/g, " ").replace(/\[[^\]]*\]\([^)]*\)/g, " ");
    const words = prose.match(/[A-Za-z][A-Za-z0-9_\-\.]*/g) || [];
    const isKnown = (w) => {
      const bare = w.replace(/[^A-Za-z]/g, "");      // 去掉数字与标点后的主干
      const stem = w.replace(/[^A-Za-z]+$/, "");     // 去掉尾部序号，如 Llama-3-8B
      return WHITELIST.has(w) || WHITELIST.has(bare) || WHITELIST.has(stem);
    };
    const bad = [...new Set(words)].filter((w) => {
      if (isKnown(w)) return false;
      if (/\d/.test(w)) return false;                // 带数字的多半是型号、版本号、量化名
      if (/^[A-Z0-9_\-\.]+$/.test(w)) return false;  // 全大写，多半是环境变量或缩写
      if (/^[a-z]{1,2}$/.test(w)) return false;      // 单位之类
      return true;
    });
    if (bad.length) {
      console.log(`[疑似英文残词] ${file}:${lineNo}  ${bad.join(", ")}\n    ${line.slice(0, 90)}`);
      problems++;
    }
  });
}

console.log(problems === 0 ? "干净，没发现混入内容。" : `发现 ${problems} 处可疑内容。`);
