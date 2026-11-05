# herramientas/vigilante-bot.ps1 — Vigila el bot cada 10 minutos (tarea programada "DC Tecnology · vigilante del bot").
#   Instalar la tarea (una sola vez):  powershell -ExecutionPolicy Bypass -File herramientas\vigilante-bot.ps1 -Instalar
#   Revisar a mano:                    powershell -ExecutionPolicy Bypass -File herramientas\vigilante-bot.ps1
#
# 1) WhatsApp: Evolution puede decir "open" con la conexión trabada ("Connection Closed": no envía nada). Se prueba con una
#    consulta real que NO envía mensajes (/chat/whatsappNumbers). Si falla dos veces seguidas, reinicia Evolution (la sesión
#    está en su base: se reconecta sin QR).
# 2) Etiquetas de WhatsApp Business (BAENAMORA): las recarga en el bot (herramientas/sincronizar-etiquetas.mjs --aplicar).
# 3) n8n: si no responde, lo enciende con SU carpeta de datos (la .n8n más reciente de C:\Users, o N8N_CARPETA en .env) y la
#    versión que ya tiene descargada; si no arranca, te avisa por WhatsApp directo por Evolution (máx. 1 vez cada 6 h).
#    Solo como SYSTEM o administrador: con otra cuenta abriría un n8n vacío o viejo (del 2 al 5/11/2026 estuvo caído 3 días).
# 0) Al prender el PC enciende Evolution y n8n sin que nadie inicie sesión (tarea como SYSTEM; -Instalar pide permiso una vez).
# Registro: herramientas\salida\vigilante.log (no va a git). Salida de n8n: herramientas\salida\n8n.log.
#   Ver qué haría sin tocar nada: vigilante-bot.ps1 -Probar
param([switch]$Instalar, [switch]$Probar)
$ErrorActionPreference = 'Continue'
$raiz = Split-Path $PSScriptRoot -Parent
$tarea = 'DC Tecnology - vigilante del bot'
$identidad = [Security.Principal.WindowsIdentity]::GetCurrent()
$esSistema = $identidad.IsSystem
$esAdmin = ([Security.Principal.WindowsPrincipal]$identidad).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($Instalar) {
    if (-not $esAdmin) {
        Write-Host 'Pidiendo permiso de administrador para instalar el vigilante (una sola vez)…' -ForegroundColor Yellow
        Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', "`"$PSCommandPath`"", '-Instalar'
        exit 0
    }
    # La cuenta administradora es la que abre n8n con iniciar-bot.ps1: su carpeta queda fija en .env (N8N_CARPETA)
    $archivoEnv = Join-Path $raiz '.env'
    $lineasEnv = @(Get-Content $archivoEnv -Encoding utf8 -ErrorAction SilentlyContinue)
    if (-not ($lineasEnv -match '^N8N_CARPETA=')) {
        if (Test-Path (Join-Path $env:USERPROFILE '.n8n\database.sqlite')) {
            Add-Content $archivoEnv "`nN8N_CARPETA=$env:USERPROFILE" -Encoding utf8
            Write-Host "Datos de n8n: $env:USERPROFILE\.n8n (anotado en .env como N8N_CARPETA)" -ForegroundColor Green
        } else { Write-Host "Esta cuenta no tiene n8n ($env:USERPROFILE\.n8n): el vigilante usará la base más reciente de C:\Users. Si no es la tuya, pon N8N_CARPETA en .env." -ForegroundColor Yellow }
    }
    $accion = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
    $cada10 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10)
    $alPrender = New-ScheduledTaskTrigger -AtStartup
    $alPrender.Delay = 'PT2M'   # deja que arranquen la red y Kaspersky
    $quien = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 12) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $tarea -Action $accion -Trigger @($cada10, $alPrender) -Principal $quien -Settings $ajustes -Description 'Enciende y vigila el bot (Evolution + n8n), recarga etiquetas y deja registro. Corre como SYSTEM: funciona sin iniciar sesión. Proyecto DC Tecnology.' -Force | Out-Null
    Write-Host "Tarea '$tarea' instalada: al prender el PC y cada 10 minutos, sin necesidad de iniciar sesión." -ForegroundColor Green
    Start-ScheduledTask -TaskName $tarea
    Write-Host 'Ya quedó corriendo. En 5 minutos mira herramientas\salida\vigilante.log. Puedes cerrar esta ventana.' -ForegroundColor Cyan
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

function Escucha($puerto) { [bool](Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue) }
function N8nVivo { try { (Invoke-WebRequest 'http://localhost:5678/healthz' -UseBasicParsing -TimeoutSec 8).StatusCode -eq 200 } catch { $false } }
$versionN8n = '2.43.5'   # la misma del PC: el flujo se probó con ella

# La carpeta de datos de n8n (flujos y credenciales): N8N_CARPETA en .env o la .n8n con la base más reciente de C:\Users
function CarpetaN8n {
    if ($envVars['N8N_CARPETA']) { return [pscustomobject]@{ Perfil = $envVars['N8N_CARPETA']; Fecha = '?'; Origen = 'N8N_CARPETA' } }
    $bases = Get-ChildItem 'C:\Users' -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
        Get-Item (Join-Path $_.FullName '.n8n\database.sqlite') -Force -ErrorAction SilentlyContinue
    } | Where-Object { $_ } | Sort-Object LastWriteTime -Descending
    if (-not $bases) { return $null }
    $b = $bases | Select-Object -First 1
    [pscustomobject]@{ Perfil = $b.Directory.Parent.FullName; Fecha = $b.LastWriteTime.ToString('yyyy-MM-dd HH:mm'); Origen = 'la base más reciente' }
}
# El n8n que ya está descargado en ese perfil (npx o instalación global): así no cambia de versión al encender
function ProgramaN8n($perfil) {
    $candidatos = @(Get-ChildItem (Join-Path $perfil 'AppData\Local\npm-cache\_npx') -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'node_modules\n8n' })
    $candidatos += Join-Path $perfil 'AppData\Roaming\npm\node_modules\n8n'
    $hallados = foreach ($c in $candidatos) {
        $pkg = Join-Path $c 'package.json'
        if ((Test-Path $pkg) -and (Test-Path (Join-Path $c 'bin\n8n'))) {
            [pscustomobject]@{ Bin = (Join-Path $c 'bin\n8n'); Version = (Get-Content $pkg -Raw | ConvertFrom-Json).version; Fecha = (Get-Item $pkg).LastWriteTime }
        }
    }
    $hallados | Sort-Object Fecha -Descending | Select-Object -First 1
}
function EncenderN8n {
    $c = CarpetaN8n
    if (-not $c) { Anotar 'n8n no responde y no encontré su carpeta (.n8n\database.sqlite) en C:\Users'; return $false }
    $p = ProgramaN8n $c.Perfil
    $como = if ($p) { "n8n $($p.Version) ya descargado" } else { "npx n8n@$versionN8n (no estaba descargado)" }
    if ($Probar) { Write-Host "Encendería n8n con los datos de $($c.Perfil) ($($c.Origen), base del $($c.Fecha)) usando $como"; return $true }
    Anotar "n8n no responde: lo enciendo con los datos de $($c.Perfil) ($($c.Origen)) y $como"
    $env:N8N_USER_FOLDER = $c.Perfil
    $logN8n = Join-Path $salida 'n8n.log'
    foreach ($f in @($logN8n, "$logN8n.err")) { if (Test-Path $f) { Move-Item $f "$f.anterior" -Force } }
    if ($p) { Start-Process 'node' -ArgumentList "`"$($p.Bin)`"" -WorkingDirectory $c.Perfil -WindowStyle Hidden -RedirectStandardOutput $logN8n -RedirectStandardError "$logN8n.err" }
    else { Start-Process 'cmd.exe' -ArgumentList '/c', "npx --yes n8n@$versionN8n" -WorkingDirectory $c.Perfil -WindowStyle Hidden -RedirectStandardOutput $logN8n -RedirectStandardError "$logN8n.err" }
    $fin = (Get-Date).AddSeconds(240)
    while ((Get-Date) -lt $fin) { Start-Sleep -Seconds 5; if (N8nVivo) { Anotar 'n8n encendido: responde'; return $true } }
    Anotar "n8n no arrancó en 4 minutos: revisa $logN8n.err"
    return $false
}
function AvisarDirector($clave, $texto) {
    $r = & node (Join-Path $raiz 'herramientas\avisar-director.mjs') --clave $clave --horas 6 $texto 2>&1 | Out-String
    if ($r -notmatch 'enviado|no se repite') { Anotar "Aviso por WhatsApp: $($r.Trim() -replace '\s+', ' ')" }
}

if ($Probar) {
    Write-Host "Cuenta: $($identidad.Name) (SYSTEM: $esSistema, administrador: $esAdmin)"
    Write-Host "Evolution escucha en 8080: $(Escucha 8080) · n8n responde: $(N8nVivo)"
    [void](EncenderN8n)
    if (-not ($esSistema -or $esAdmin)) { Write-Host 'Con esta cuenta NO lo encendería (vería un n8n viejo): instala la tarea con -Instalar, que corre como SYSTEM.' -ForegroundColor Yellow }
    exit 0
}

# 0) Al prender el PC (o si alguien cerró la ventana): Evolution apagado → se enciende ya, sin esperar dos fallas
if (-not (Escucha 8080)) {
    Anotar 'Evolution estaba apagado: lo enciendo'
    $ok = ReiniciarEvolution
    Anotar ($(if ($ok) { 'Evolution encendido: WhatsApp responde' } else { 'Evolution encendido pero WhatsApp aún no responde' }))
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
$n8nVivo = N8nVivo
if (-not $n8nVivo) {
    if ($esSistema -or $esAdmin) {
        $n8nVivo = EncenderN8n
        if (-not $n8nVivo) { AvisarDirector 'n8n-caido' "⚠️ *n8n (el flujo del bot) está caído y no pude encenderlo.*`nSin él no salen avisos, resumen de ventas ni alertas de pago. En el PC de la oficina abre herramientas\iniciar-bot.ps1." }
    } else { Anotar 'n8n no responde: enciéndelo con herramientas\iniciar-bot.ps1 (o instala el vigilante con -Instalar para que lo encienda solo)' }
}
elseif ($estado.fallos -eq 0) {
    $res = & node (Join-Path $raiz 'herramientas\sincronizar-etiquetas.mjs') --aplicar 2>&1 | Out-String
    if ($res -notmatch 'bot actualizado') { Anotar "Etiquetas: $($res.Trim() -replace '\s+', ' ')" }
}
