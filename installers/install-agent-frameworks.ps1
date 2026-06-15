<#
.SYNOPSIS
  Install AI agent frameworks: CrewAI, AutoGen, LangChain.
  All configured to use local Ollama models by default.
#>

$ErrorActionPreference = "Stop"

function Status { Write-Host "  → $_" -ForegroundColor Cyan }

# ── 1. CrewAI ──
$crewCheck = pip show crewai 2>$null
if ($crewCheck) {
  Status "CrewAI already installed"
} else {
  Status "Installing CrewAI..."
  pip install crewai crewai-tools --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Status "  CrewAI installed (use with Ollama: model = 'ollama/llama3.1:8b')"
  } else {
    Write-Host "  ⚠ CrewAI install failed" -ForegroundColor Yellow
  }
}

# ── 2. AutoGen (Microsoft) ──
$autogenCheck = pip show pyautogen 2>$null
if ($autogenCheck) {
  Status "AutoGen already installed"
} else {
  Status "Installing AutoGen..."
  pip install pyautogen --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Status "  AutoGen installed (config_list = [{'model': 'llama3.1:8b', 'base_url': 'http://localhost:11434'}])"
  } else {
    Write-Host "  ⚠ AutoGen install failed" -ForegroundColor Yellow
  }
}

# ── 3. LangChain community ──
$langCheck = pip show langchain-community 2>$null
if ($langCheck) {
  Status "LangChain already installed"
} else {
  Status "Installing LangChain + Ollama integration..."
  pip install langchain langchain-community langchain-ollama --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Status "  LangChain ready"
  }
}

# ── 4. PraisonAI (low-code agent teams) ──
$praisonCheck = pip show praisonai 2>$null
if ($praisonCheck) {
  Status "PraisonAI already installed"
} else {
  Status "Installing PraisonAI (GUI agent builder)..."
  pip install praisonai --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Status "  PraisonAI installed"
  }
}

# ── demo: create a sample crew file ──
$demoDir = "$env:USERPROFILE\AI-Agents"
$demoFile = Join-Path $demoDir "demo_crew.py"
if (-not (Test-Path $demoFile)) {
  $null = New-Item -ItemType Directory -Path $demoDir -Force
  @"
from crewai import Agent, Task, Crew

researcher = Agent(
    role="Research Analyst",
    goal="Find the latest AI news and summarize it",
    backstory="You're a tech journalist who reads 50 papers a week.",
    allow_delegation=False,
    llm="ollama/llama3.1:8b"
)

writer = Agent(
    role="Content Writer",
    goal="Turn research into a blog post",
    backstory="You write clear, engaging technical content.",
    allow_delegation=False,
    llm="ollama/llama3.1:8b"
)

research = Task(
    description="Find 3 recent developments in local AI",
    expected_output="Bullet points with citations",
    agent=researcher
)

write = Task(
    description="Write a 300-word blog post from the research",
    expected_output="A complete blog post",
    agent=writer
)

crew = Crew(agents=[researcher, writer], tasks=[research, write])
result = crew.kickoff()
print(result)
"@ | Set-Content -Path $demoFile -Encoding UTF8
  Status "Demo crew created at $demoFile"
}

Write-Host "`n  ✓ Agent frameworks ready" -ForegroundColor Green
Write-Host "  → CrewAI demo: python $demoFile" -ForegroundColor DarkGray
Write-Host "  → PraisonAI UI: praisonai --ui" -ForegroundColor DarkGray
