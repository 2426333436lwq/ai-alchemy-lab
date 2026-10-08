import json, sys, os

GiB = 1024 ** 3

# 用法
#   python vram_estimate.py <模型目录> <每权重bit数> <单条上下文长度> [并发数] [可用显存GiB]
# 例
#   python vram_estimate.py ./Qwen2.5-7B-Instruct 4.89 8192 1 24

def load_config(path):
    c = json.load(open(os.path.join(path, "config.json"), encoding="utf-8"))
    # 部分模型把结构藏在 text_config / language_config 里
    for k in ("text_config", "language_config", "model"):
        if k in c and isinstance(c[k], dict) and "num_hidden_layers" in c[k]:
            base = dict(c)
            base.update(c[k])
            c = base
            break
    return c

def count_params(c):
    h = c["hidden_size"]
    L = c["num_hidden_layers"]
    nh = c["num_attention_heads"]
    nkv = c.get("num_key_value_heads", nh)
    inter = c.get("intermediate_size", 4 * h)
    vocab = c.get("vocab_size", 32000)
    hd = c.get("head_dim", h // nh)          # 每头维度
    kv_dim = nkv * hd                         # GQA 之后 K/V 的真实宽度

    # MoE 可能有多份专家，这里只做最朴素的单层一份 FFN 估算
    per_layer = (
        h * (nh * hd)      # q_proj
        + h * kv_dim       # k_proj
        + h * kv_dim       # v_proj
        + (nh * hd) * h    # o_proj
        + h * inter        # gate_proj
        + h * inter        # up_proj
        + inter * h        # down_proj
    )
    embed = vocab * h
    tied = c.get("tie_word_embeddings", False)
    lm_head = 0 if tied else vocab * h
    return per_layer * L + embed + lm_head

def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    bpw = float(sys.argv[2])
    seq = int(sys.argv[3])
    nseq = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    vram = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0

    c = load_config(path)
    n = count_params(c)

    # 优先用真实索引里的字节数，算不准的部分交给它
    idx = os.path.join(path, "model.safetensors.index.json")
    if os.path.exists(idx):
        meta = json.load(open(idx, encoding="utf-8")).get("metadata", {})
        if "total_size" in meta:
            raw_bytes = meta["total_size"]
            raw_dtype_bits = raw_bytes * 8 / n
            src = "索引里的真实字节数"
        else:
            raw_bytes = None
    else:
        raw_bytes = None
    if raw_bytes is None:
        # 默认存的是 BF16
        raw_dtype_bits = 16.0
        src = "按 BF16 假设推算"

    h = c["hidden_size"]
    L = c["num_hidden_layers"]
    nh = c["num_attention_heads"]
    nkv = c.get("num_key_value_heads", nh)
    hd = c.get("head_dim", h // nh)

    weights_bytes = n * bpw / 8
    # KV cache，默认 fp16（2 字节）
    kv_per_token = 2 * L * nkv * hd * 2
    kv_bytes = kv_per_token * seq * nseq

    print(f"模型目录        {path}")
    print(f"参数量          {n/1e9:.2f} B（{n:,}）")
    print(f"结构            {L} 层，{nh} 注意力头，{nkv} 个 KV 头，每头 {hd} 维")
    print(f"原始精度来源    {src}，约 {raw_dtype_bits:.1f} bit/权重")
    print("-" * 52)
    print(f"权重            {weights_bytes/GiB:8.2f} GiB   （{bpw} bpw）")
    print(f"KV 缓存         每 token {kv_per_token/1024:.1f} KiB")
    print(f"                {seq} token x {nseq} 路并发 = {kv_bytes/GiB:8.2f} GiB")
    OVERHEAD = 1.5 * GiB                      # CUDA context、算子库、碎片，经验值
    print(f"运行时开销      {OVERHEAD/GiB:8.2f} GiB   （经验值，可自己调）")
    total = weights_bytes + kv_bytes + OVERHEAD
    print("-" * 52)
    print(f"合计            {total/GiB:8.2f} GiB")
    if vram:
        left = vram * GiB - total
        print(f"目标显存        {vram:.2f} GiB")
        if left >= 0:
            print(f"余量            {left/GiB:8.2f} GiB   ✅ 装得下")
        else:
            print(f"缺口            {-left/GiB:8.2f} GiB   ❌ 装不下，见下面三选一")
            print("   1) 降 bpw      Q4_K_M 4.89 -> Q3_K_M 4.00，省 %.2f GiB"
                  % (n * (bpw - 4.0) / 8 / GiB))
            print("   2) KV 量化     fp16 -> q8_0，KV 省 %.2f GiB"
                  % (kv_bytes / 2 / GiB))
            print("   3) 降并发/长度 上下文 %d -> %d 可省 %.2f GiB"
                  % (seq, seq // 2, kv_per_token * (seq - seq // 2) * nseq / GiB))

if __name__ == "__main__":
    main()
