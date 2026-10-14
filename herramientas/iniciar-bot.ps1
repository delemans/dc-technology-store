# herramientas/iniciar-bot.ps1 — Enciende el bot de WhatsApp en este PC (Evolution API + n8n) y comprueba que respondan.
#
#   Clic derecho → "Ejecutar con PowerShell", o en una consola:
#   powershell -ExecutionPolicy Bypass -File "herramientas\iniciar-bot.ps1"
#
# - Usa el certificado de Kaspersky (NODE_EXTRA_CA_CERTS): sin él, Node no puede conectarse a WhatsApp ni a Supabase.
# - Si un servicio ya está encendido, no lo vuelve a abrir. Cada uno queda en su propia ventana: NO las cierres.
# - Evolution guarda la sesión de WhatsApp en su base (Neon): al encender, dc-bot se reconecta sin QR.

$ErrorActionPreference = 'Stop'

# n8n guarda flujos y credenciales en la carpeta .n8n de la cuenta que lo ejecuta. Los tuyos están en la cuenta
# "Administrador": si este script corre con otra cuenta, se vuelve a abrir como administrador (Windows pide permiso).
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
    Write-Host 'Pidiendo permiso de administrador para abrir TU n8n (el que tiene el flujo y las credenciales)…' -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', "`"$PSCommandPath`""
    exit
}
Write-Host "Cuenta: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
$certificado = 'C:\evolution-api\kaspersky-ca.pem'
$carpetaEvolution = 'C:\evolution-api\evolution-api-main'
# La clave de Evolution sale de .env (EVOLUTION_API_KEY): nunca se escribe en el repositorio
$claveEvolution = ((Get-Content (Join-Path $PSScriptRoot '...env') -ErrorAction SilentlyContinue) | Where-Object { $_ -match '^EVOLUTION_API_KEY=' } | Select-Object -First 1) -replace '^EVOLUTION_API_KEY=', ''

function Escucha($puerto) { [bool](Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue) }
function Esperar($nombre, $prueba, $segundos) {
    $fin = (Get-Date).AddSeconds($segundos)
    while ((Get-Date) -lt $fin) { if (& $prueba) { Write-Host "  ✔ $nombre en línea" -ForegroundColor Green; return $true }; Start-Sleep -Seconds 3 }
    Write-Host "  ✘ $nombre no respondió en $segundos s: revisa su ventana" -ForegroundColor Red; return $false
}

if (-not (Test-Path $certificado)) { Write-Host "Falta $certificado (certificado de Kaspersky)." -ForegroundColor Red; exit 1 }
$env:NODE_EXTRA_CA_CERTS = $certificado
Write-Host "`nEncendiendo el bot de DC TECHNOLOGY…" -ForegroundColor Cyan

# 1) Evolution API (WhatsApp)
if (Escucha 8080) { Write-Host '  · Evolution ya estaba encendido' }
else {
    Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$env:NODE_EXTRA_CA_CERTS='$certificado'; `$host.UI.RawUI.WindowTitle='Evolution API (no cerrar)'; Set-Location '$carpetaEvolution'; npm run start"
    [void](Esperar 'Evolution' { try { (Invoke-WebRequest 'http://localhost:8080/' -UseBasicParsing -TimeoutSec 4).StatusCode -eq 200 } catch { $false } } 120)
}

# 2) n8n (el flujo del bot)
if (Escucha 5678) { Write-Host '  · n8n ya estaba encendido' }
else {
    Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$env:NODE_EXTRA_CA_CERTS='$certificado'; `$host.UI.RawUI.WindowTitle='n8n (no cerrar)'; npx n8n"
    [void](Esperar 'n8n' { try { (Invoke-WebRequest 'http://localhost:5678/healthz' -UseBasicParsing -TimeoutSec 4).StatusCode -eq 200 } catch { $false } } 180)
}

# 3) Estado del WhatsApp del bot
try {
    $estado = (Invoke-RestMethod 'http://localhost:8080/instance/connectionState/dc-bot' -Headers @{ apikey = $claveEvolution } -TimeoutSec 10).instance.state
    $color = if ($estado -eq 'open') { 'Green' } else { 'Yellow' }
    Write-Host "  · WhatsApp dc-bot: $estado" -ForegroundColor $color
    if ($estado -ne 'open') { Write-Host '    Si en 1 minuto no pasa a "open", hay que volver a vincular el celular del bot (QR).' -ForegroundColor Yellow }
} catch { Write-Host "  · No pude leer el estado de dc-bot: $($_.Exception.Message)" -ForegroundColor Yellow }

Write-Host "`nListo. Deja abiertas las ventanas 'Evolution API' y 'n8n'. Panel → Prueba del sistema para revisar todo.`n" -ForegroundColor Cyan
