#!/usr/bin/env bash
# recognize-image.sh — 用本地 Codex CLI 的视觉能力识别图片
#
# 背景：本机根文件系统是只读的（DSH 沙箱），而 Codex 运行时需要在
# $CODEX_HOME 下写 session/cache/lock 文件，所以每次调用都会在 /tmp
# 建一个可写的临时 HOME，把登录凭据（auth.json / config.toml）复制进去。
#
# 用法:
#   recognize-image.sh <图片路径> [prompt...]
#   IMAGE 额外图片，逗号分隔  recognize-image.sh -i a.png,b.png "对比两张图"
#
# 环境变量:
#   RECOGNIZE_OUTPUT  结果文件路径（默认 /tmp/codex_img_result.txt）
#   RECOGNIZE_MODEL   覆盖模型（默认 gpt-5.5；config.toml 里的 gpt-5.6-sol 要求更新版 CLI）
#   RECOGNIZE_VERBOSE 置 1 时保留并打印 codex 完整日志

set -euo pipefail

CODEX_BIN=""
CODEX_SRC_HOME="${CODEX_SRC_HOME:-$HOME/.codex}"

# 自动探测 codex CLI：按 node 版本号从高到低，选第一个可用的 codex
# （本机 v22.14.0 装了旧版 codex 0.120.0，v24.13.0 才是 0.147.0；
#  直接按字母序会误选旧版，导致新模型报 "requires a newer version"）
find_codex() {
  local nvm_root="${NVM_DIR:-$HOME/.nvm}/versions/node"
  local cand ver
  # 优先用显式指定
  if [[ -n "${CODEX_BIN_OVERRIDE:-}" ]]; then
    CODEX_BIN="$CODEX_BIN_OVERRIDE"
    return
  fi
  for ver in $(ls -1 "$nvm_root" 2>/dev/null | sort -Vr); do
    cand="$nvm_root/$ver/bin/codex"
    if [[ -L "$cand" && -x "$(readlink -f "$cand" 2>/dev/null)" ]]; then
      CODEX_BIN="$cand"
      return
    fi
    if [[ -x "$cand" && ! -L "$cand" ]]; then
      CODEX_BIN="$cand"
      return
    fi
  done
  # 回退：系统级 codex
  if [[ -L /usr/local/bin/codex && -x "$(readlink -f /usr/local/bin/codex 2>/dev/null)" ]]; then
    CODEX_BIN=/usr/local/bin/codex
    return
  fi
  echo "error: 未找到可用的 codex CLI" >&2
  exit 1
}

find_codex

# 解析参数：支持 -i 传多个图（逗号分隔）
IMAGES=()
declare -a PROMPT_PARTS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -i|--image)
      IFS=',' read -ra _imgs <<< "${2:-}"
      IMAGES+=("${_imgs[@]}")
      shift 2
      ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      if [[ ${#IMAGES[@]} -eq 0 ]]; then
        IMAGES+=("$1")
      else
        PROMPT_PARTS+=("$1")
      fi
      shift
      ;;
  esac
done

if [[ ${#IMAGES[@]} -eq 0 ]]; then
  echo "error: 需要至少一个图片路径" >&2
  exit 1
fi

PROMPT="${PROMPT_PARTS[*]:-请用简洁的中文描述这张图片的内容，包括主体、动作/状态和关键细节。}"

RUN_ROOT="${RECOGNIZE_RUN_ROOT:-/tmp/codex-img-run}"
OUTPUT_FILE="${RECOGNIZE_OUTPUT:-/tmp/codex_img_result.txt}"
LOG_FILE="${RECOGNIZE_LOG:-/tmp/codex_img_run.log}"
MODEL="${RECOGNIZE_MODEL:-gpt-5.5}"

# 建可写临时 HOME 并复制登录凭据（凭据内容不会写入本脚本或任何 git 文件）
rm -rf "$RUN_ROOT"
mkdir -p "$RUN_ROOT/.codex" "$RUN_ROOT/.cache" "$RUN_ROOT/.runtime"
cp "$CODEX_SRC_HOME/auth.json" "$RUN_ROOT/.codex/auth.json" 2>/dev/null || true
cp "$CODEX_SRC_HOME/config.toml" "$RUN_ROOT/.codex/config.toml" 2>/dev/null || true
chmod 600 "$RUN_ROOT/.codex/auth.json" 2>/dev/null || true

export HOME="$RUN_ROOT"
export CODEX_HOME="$RUN_ROOT/.codex"
export XDG_CACHE_HOME="$RUN_ROOT/.cache"
export XDG_RUNTIME_DIR="$RUN_ROOT/.runtime"
export TMPDIR=/tmp

ARGS=()
for img in "${IMAGES[@]}"; do
  ARGS+=(-i "$img")
done

"$CODEX_BIN" exec -c "model=\"$MODEL\"" "$PROMPT" \
  --ephemeral \
  --skip-git-repo-check \
  -s read-only \
  -o "$OUTPUT_FILE" \
  "${ARGS[@]}" \
  </dev/null >"$LOG_FILE" 2>&1 || {
    echo "error: codex 调用失败，日志如下:" >&2
    tail -30 "$LOG_FILE" >&2
    exit 1
  }

# 打印最终识别结果
if [[ -f "$OUTPUT_FILE" ]]; then
  cat "$OUTPUT_FILE"
else
  echo "warning: 未生成结果文件，完整日志见 $LOG_FILE" >&2
  tail -20 "$LOG_FILE" >&2
fi

# 清理临时凭据副本
rm -rf "$RUN_ROOT"
