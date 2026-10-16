# herramientas/vigilante-bot.ps1 — Vigila el bot cada 10 minutos (tarea programada "DC Tecnology · vigilante del bot").
#   Instalar la tarea (una sola vez):  powershell -ExecutionPolicy Bypass -File herramientas\vigilante-bot.ps1 -Instalar
#   Revisar a mano:                    powershell -ExecutionPolicy Bypass -File herramientas\vigilante-bot.ps1
#
# 1) WhatsApp: Evolution puede decir "open" con la conexión trabada ("Connection Closed": no envía nada). Se prueba con una
#    consulta real que NO envía mensajes (/chat/whatsappNumbers). Si falla dos veces seguidas, reinicia Evolution (la sesión
#    está en su base: se reconecta sin QR).
# 2) Etiquetas de WhatsApp Business (BAENAMORA): las recarga en el bot (herramientas/sincronizar-etiquetas.mjs --aplicar).
# 3) n8n: si no responde, lo deja anotado (n8n corre como administrador: se enciende con herramientas\iniciar-bot.ps1).
# Registro: herramientas\salida\vigilante.log (no va a git).
param([switch]$Instalar)
$ErrorActionPreference = 'Continue'
$raiz = Split-Path $PSScriptRoot -Parent
$tarea = 'DC Tecnology - vigilante del bot'

if ($Instalar) {
    $accion = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
    $disparo = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10)
    $ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 8) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $tarea -Action $accion -Trigger $disparo -Settings $ajustes -Description 'Revisa WhatsApp (Evolution), recarga etiquetas y deja registro. Proyecto DC Tecnology.' -Force | Out-Null
    Write-Host "Tarea '$tarea' instalada: corre cada 10 minutos." -ForegroundColor Green
    exit 0
}

$salida = Join-Path $raiz 'herramientas\salida'
New-Item -ItemType Directory -Force $salida | Out-Null
$log = Join-Path $salida 'vigilante.log'
function Anotar($texto) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $texto" | Add-Content -Path $log -Encoding utf8 }
if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) { Move-Item $log "$log.anterior" -Force }

$envVars = @{}
Get-Content (Join-Path $raiz '.env') -ErrorAction SilentlyContinue | ForEach-Object { if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $envVars[$matches[1]] = $matches[2].Trim().Trim('"') } }
$evo = $(if ($envVars['EVOLUTION_URL']) { $envVars['EVOLUTION_URL'] } else { 'http://localhost:8080' }).TrimEnd('/')
$inst = $envVars['EVOLUTION_INSTANCIA']
$clave = $envVars['EVOLUTION_API_KEY']
$certificado = 'C:\evolution-api\kaspersky-ca.pem'
$carpetaEvolution = if ($envVars['EVOLUTION_CARPETA']) { $envVars['EVOLUTION_CARPETA'] } else { 'C:\evolution-api\evolution-api-main' }
$env:NODE_EXTRA_CA_CERTS = $certificado
$estadoArchivo = Join-Path $salida 'vigilante-estado.json'
$estado = if (Test-Path $estadoArchivo) { Get-Content $estadoArchivo -Raw | ConvertFrom-Json } else { [pscustomobject]@{ fallos = 0 } }

function WhatsAppSirve {
    try {
        $r = Invoke-RestMethod "$evo/chat/whatsappNumbers/$inst" -Method Post -Headers @{ apikey = $clave } -ContentType 'application/json' -Body '{"numbers":["573223284622"]}' -TimeoutSec 25
        return [bool]($r | Where-Object { $null -ne $_.exists })
    } catch { return $false }
}
function ReiniciarEvolution {
    $ids = Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape($carpetaEvolution) -or $_.CommandLine -match 'npm-cli.js" run start' } | Select-Object -ExpandProperty ProcessId
    foreach ($i in $ids) { try { Stop-Process -Id $i -Force -ErrorAction Stop } catch {} }
    Start-Sleep -Seconds 3
    Start-Process powershell -WindowStyle Minimized -ArgumentList '-NoExit', '-Command', "`$env:NODE_EXTRA_CA_CERTS='$certificado'; `$host.UI.RawUI.WindowTitle='Evolution API (no cerrar)'; Set-Location '$carpetaEvolution'; npm run start"
    $fin = (Get-Date).AddSeconds(150)
    while ((Get-Date) -lt $fin) { Start-Sleep -Seconds 5; if (WhatsAppSirve) { return $true } }
    return $false
}

# 1) WhatsApp
if (WhatsAppSirve) {
    if ($estado.fallos -gt 0) { Anotar 'WhatsApp volvió a responder' }
    $estado.fallos = 0
} else {
    $estado.fallos = [int]$estado.fallos + 1
    Anotar "WhatsApp no responde (falla $($estado.fallos))"
    if ($estado.fallos -ge 2) {
        Anotar 'Reiniciando Evolution…'
        $ok = ReiniciarEvolution
        Anotar ($(if ($ok) { 'Evolution reiniciado: WhatsApp responde' } else { 'Evolution reiniciado pero WhatsApp sigue sin responder: puede requerir volver a vincular el QR' }))
        $estado.fallos = if ($ok) { 0 } else { 2 }
    }
}
# 1b) ¿Entran mensajes? Si lleva horas sin recibir nada (envía pero no recibe), reinicia Evolution (máx. 1 vez cada 6 h) y te avisa
if ($estado.fallos -eq 0) {
    $res = & node (Join-Path $raiz 'herramientas\revisar-entrada.mjs') 2>&1 | Out-String
    if ($LASTEXITCODE -eq 2) {
        $ultimoReinicio = if ($estado.PSObject.Properties['reinicioEntrada']) { [datetime]$estado.reinicioEntrada } else { [datetime]::MinValue }
        if (((Get-Date) - $ultimoReinicio).TotalHours -ge 6) {
            Anotar "Sin mensajes entrantes ($($res.Trim())): reiniciando Evolution"
            [void](ReiniciarEvolution)
            $estado | Add-Member -NotePropertyName reinicioEntrada -NotePropertyValue (Get-Date).ToString('o') -Force
            Start-Sleep -Seconds 120
        }
        $res2 = & node (Join-Path $raiz 'herramientas\revisar-entrada.mjs') --avisar 2>&1 | Out-String
        if ($LASTEXITCODE -eq 2) { Anotar "Sigue sin entrar ningún mensaje: $($res2.Trim() -replace '\s+', ' ')" }
    }
}
$estado | ConvertTo-Json | Set-Content $estadoArchivo -Encoding utf8

# 2) Etiquetas (solo si WhatsApp y n8n responden)
$n8nVivo = $false
try { $n8nVivo = (Invoke-WebRequest 'http://localhost:5678/healthz' -UseBasicParsing -TimeoutSec 8).StatusCode -eq 200 } catch {}
if (-not $n8nVivo) { Anotar 'n8n no responde: enciéndelo con herramientas\iniciar-bot.ps1' }
elseif ($estado.fallos -eq 0) {
    $res = & node (Join-Path $raiz 'herramientas\sincronizar-etiquetas.mjs') --aplicar 2>&1 | Out-String
    if ($res -notmatch 'bot actualizado') { Anotar "Etiquetas: $($res.Trim() -replace '\s+', ' ')" }
}
