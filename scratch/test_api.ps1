$loginBody = '{"email":"admin@whatsapp.local","password":"adminpassword123"}'
try {
    $loginResp = Invoke-WebRequest -Uri 'http://localhost:3005/auth/login' -Method POST -Body $loginBody -ContentType 'application/json' -UseBasicParsing -TimeoutSec 10
    $loginData = $loginResp.Content | ConvertFrom-Json
    $token = $loginData.token
    Write-Output "Login OK. Token starts: $($token.Substring(0,20))..."
    
    $headers = @{ Authorization = "Bearer $token" }
    $meResp = Invoke-WebRequest -Uri 'http://localhost:3005/auth/me' -Headers $headers -UseBasicParsing -TimeoutSec 15
    Write-Output "ME status: $($meResp.StatusCode)"
    Write-Output $meResp.Content
} catch {
    Write-Output "ERROR: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Output "Response: $($reader.ReadToEnd())"
    }
}
