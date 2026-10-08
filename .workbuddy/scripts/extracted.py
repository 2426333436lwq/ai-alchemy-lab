import json, sys, os

GiB = 1024 ** 3
USAGE = "用法：python vram_estimate.py <模型目录> <bpw> <上下文长度> [并发数] [可用显存GiB]\n" \
        "例子：python vram_estimate.py ./Qwen2.5-7B-Instruct 4.89 8192 1 24"

def load_config(path):
    c = json.load(open(os.path.join(path, "config.json"), encoding="utf-8"))
    # 多模态模型常把语言塔藏在 text_config / language_config 里
    for k in ("text_config", "language_config", "model"):
        if isinstance(c.get(k), dict) and "num_hidden_layers" in c[k]:
            base = dict(c); base.update(c[k]); c = base; break
    return c

def count_params(c):
    h, L = c["hidden_size"], c["num_hidden_layers"]
    nh = c["num_attention_heads"]
    nkv = c.get("num_key_value_heads", nh)
    inter = c.get("intermediate_size", 4 * h)
    vocab = c.get("vocab_size", 32000)
    hd = c.get("head_dim", h // nh)
    kv_dim = nkv * hd
    per_layer = (h * (nh * hd) + h * kv_dim * 2 + (nh * hd) * h
                 + h * inter * 2 + inter * h)
    total = per_layer * L + vocab * h
    if not c.get("tie_word_embeddings", False):
        total += vocab * h          # 输出层没和嵌入层共用，再算一份
    return total

def main():
    if len(sys.argv) < 4:
        print(USAGE); sys.exit(1)
    path, bpw, seq = sys.argv[1], float(sys.argv[2]), int(sys.argv[3])
    nseq = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    vram = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0

    c = load_config(path)
    n = count_params(c)
    h, L = c["hidden_size"], c["num_hidden_layers"]
    nh = c["num_attention_heads"]
    nkv = c.get("num_key_value_heads", nh)
    hd = c.get("head_dim", h // nh)

    w_bytes = n * bpw / 8                       # 权重
    kv_pt = 2 * L * nkv * hd * 2                # KV，默认 fp16
    kv_bytes = kv_pt * seq * nseq
    OVERHEAD = 1.5 * GiB                        # 经验值，自己调

    print(f"参数量        {n/1e9:.2f} B")
    print(f"结构          {L} 层 / {nh} 头 / {nkv} 个 KV 头 / 每头 {hd} 维")
    print(f"权重          {w_bytes/GiB:6.2f} GiB  （{bpw} bpw）")
    print(f"KV 缓存       {kv_pt/1024:.1f} KiB/token × {seq} × {nseq} = {kv_bytes/GiB:6.2f} GiB")
    print(f"运行时开销    {OVERHEAD/GiB:6.2f} GiB")
    total = w_bytes + kv_bytes + OVERHEAD
    print(f"合计          {total/GiB:6.2f} GiB")

    if vram:
        left = vram * GiB - total
        if left >= 0:
            print(f"余量          {left/GiB:6.2f} GiB  ✅ 装得下")
        else:
            print(f"缺口          {-left/GiB:6.2f} GiB  ❌ 装不下")
            print(f"  降 bpw 到 Q3_K_M 省 {n*(bpw-4.0)/8/GiB:.2f} GiB")
            print(f"  KV 转 q8_0  省 {kv_bytes/2/GiB:.2f} GiB")
            print(f"  上下文砍半  省 {kv_pt*(seq-seq//2)*nseq/GiB:.2f} GiB")

if __name__ == "__main__":
    main()
