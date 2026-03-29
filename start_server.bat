@echo off
echo Starting Recipe App Server...
echo.
echo Open your browser and go to: http://localhost:8000
echo Press Ctrl+C to stop the server
echo.

powershell -Command "& {
    Add-Type -AssemblyName System.Web
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add('http://localhost:8000/')
    $listener.Start()
    Write-Host 'Server running at http://localhost:8000/'
    Write-Host 'Press Ctrl+C to stop...'
    
    while ($listener.IsListening) {
        try {
            $context = $listener.GetContext()
            $request = $context.Request
            $response = $context.Response
            
            $path = $request.Url.LocalPath
            if ($path -eq '/') { $path = '/index.html' }
            
            $filePath = Join-Path (Get-Location) $path.TrimStart('/')
            
            if (Test-Path $filePath) {
                $content = Get-Content $filePath -Raw -Encoding UTF8
                
                if ($filePath.EndsWith('.html')) {
                    $response.ContentType = 'text/html; charset=utf-8'
                } elseif ($filePath.EndsWith('.css')) {
                    $response.ContentType = 'text/css; charset=utf-8'
                } elseif ($filePath.EndsWith('.js')) {
                    $response.ContentType = 'application/javascript; charset=utf-8'
                } else {
                    $response.ContentType = 'text/plain; charset=utf-8'
                }
                
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($content)
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            } else {
                $response.StatusCode = 404
                $errorContent = 'File not found: ' + $path
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($errorContent)
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            }
            
            $response.Close()
        } catch {
            Write-Host 'Error: ' $_.Exception.Message
        }
    }
}"