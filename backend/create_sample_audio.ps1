Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile('backend\data\sample_meeting.wav')
$synth.Speak('Welcome to the AI meeting copilot. Today we will discuss the project roadmap and assign action items.')
$synth.Dispose()
Write-Host "Synthesized test audio created at backend\data\sample_meeting.wav"
