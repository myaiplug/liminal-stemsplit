<#
.SYNOPSIS
  Install RAG stack: ChromaDB + sentence-transformers + embeddings for local document Q&A.
#>

$ErrorActionPreference = "Stop"

function Status { Write-Host "  → $_" -ForegroundColor Cyan }

# ── 1. ChromaDB ──
$chromaCheck = pip show chromadb 2>$null
if ($chromaCheck) {
  Status "ChromaDB already installed"
} else {
  Status "Installing ChromaDB..."
  pip install chromadb --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Status "  ChromaDB installed" }
}

# ── 2. sentence-transformers ──
$stCheck = pip show sentence-transformers 2>$null
if ($stCheck) {
  Status "sentence-transformers already installed"
} else {
  Status "Installing sentence-transformers..."
  pip install sentence-transformers --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Status "  sentence-transformers installed" }
}

# ── 3. additional RAG tools ──
$ragPkgs = @("langchain-chroma", "unstructured", "pypdf", "docx2txt", "markdown-it-py")
foreach ($pkg in $ragPkgs) {
  $check = pip show $pkg 2>$null
  if (-not $check) {
    pip install $pkg --quiet 2>&1 | Out-Null
    Status "  $pkg installed"
  }
}

# ── 4. Ollama embedding models ──
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollama) {
  $embModels = @("nomic-embed-text", "mxbai-embed-large")
  foreach ($m in $embModels) {
    $pulled = ollama list 2>$null | Select-String $m
    if (-not $pulled) {
      Status "Pulling Ollama embedding model: $m..."
      ollama pull $m 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) { Status "  $m pulled" }
    } else { Status "Embedding model already cached: $m" }
  }
}

# ── 5. demo script ──
$demoDir = "$env:USERPROFILE\AI-Agents"
$demoFile = Join-Path $demoDir "rag_demo.py"
if (-not (Test-Path $demoFile)) {
  $null = New-Item -ItemType Directory -Path $demoDir -Force
  @"
import chromadb
from sentence_transformers import SentenceTransformer

client = chromadb.PersistentClient(path="./chroma_data")
model = SentenceTransformer("all-MiniLM-L6-v2")

docs = [
    "Liminal StemSplit runs entirely on your local GPU.",
    "AceStep generates full songs with vocals from text prompts.",
    "ComfyUI is a node-based interface for Stable Diffusion."
]

# embed + store
embeddings = model.encode(docs)
collection = client.get_or_create_collection("local-ai")
collection.add(documents=docs, embeddings=embeddings.tolist(), ids=[f"doc{i}" for i in range(len(docs))])

# query
q = "What runs on GPU?"
qe = model.encode([q]).tolist()
results = collection.query(query_embeddings=qe, n_results=1)
print(f"Query: {q}")
print(f"Result: {results['documents'][0][0]}")
"@ | Set-Content -Path $demoFile -Encoding UTF8
  Status "RAG demo script at $demoFile"
}

Write-Host "`n  ✓ RAG stack ready" -ForegroundColor Green
Write-Host "  → Demo: python $demoFile" -ForegroundColor DarkGray
Write-Host "  → ChromaDB server: chroma run --path D:\AI-Tools\chroma-data" -ForegroundColor DarkGray
