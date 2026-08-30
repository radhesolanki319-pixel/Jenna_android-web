package ai.studio.jenna.audio

import android.content.Context
import android.media.MediaPlayer
import android.util.Base64
import android.util.Log
import android.webkit.WebView
import java.io.File
import java.io.FileOutputStream

class AndroidAudioPlayer(
    private val context: Context,
    private val webViewProvider: () -> WebView?
) {
    private var mediaPlayer: MediaPlayer? = null
    private var tempAudioFile: File? = null

    fun playBase64(base64Data: String, mimeType: String): Boolean {
        stop()

        try {
            val audioBytes = Base64.decode(base64Data, Base64.DEFAULT)
            
            // Check if PCM/raw and build standard WAV header if necessary
            val finalBytes = if (mimeType.contains("pcm", ignoreCase = true) || 
                                 mimeType.contains("l16", ignoreCase = true) || 
                                 mimeType.contains("raw", ignoreCase = true)) {
                addWavHeader(audioBytes, sampleRate = 24000, channels = 1)
            } else {
                audioBytes
            }

            tempAudioFile = File.createTempFile("jenna_audio_", ".wav", context.cacheDir).apply {
                deleteOnExit()
                FileOutputStream(this).use { it.write(finalBytes) }
            }

            mediaPlayer = MediaPlayer().apply {
                setDataSource(tempAudioFile!!.absolutePath)
                setOnCompletionListener {
                    Log.d("JennaAudio", "Audio playback completed")
                    notifyFinished()
                    cleanup()
                }
                setOnErrorListener { _, what, extra ->
                    Log.w("JennaAudio", "MediaPlayer error: what=$what, extra=$extra")
                    notifyFinished()
                    cleanup()
                    true
                }
                prepare()
                start()
            }
            return true
        } catch (e: Exception) {
            Log.e("JennaAudio", "Failed to play base64 audio", e)
            notifyFinished()
            cleanup()
            return false
        }
    }

    fun stop() {
        try {
            if (mediaPlayer?.isPlaying == true) {
                mediaPlayer?.stop()
            }
        } catch (e: Exception) {
            Log.w("JennaAudio", "Error stopping audio player", e)
        } finally {
            cleanup()
        }
    }

    private fun cleanup() {
        try {
            mediaPlayer?.release()
        } catch (e: Exception) {}
        mediaPlayer = null

        try {
            tempAudioFile?.delete()
        } catch (e: Exception) {}
        tempAudioFile = null
    }

    private fun notifyFinished() {
        val wv = webViewProvider() ?: return
        wv.post {
            wv.evaluateJavascript("if (window.__onJennaAndroidAudioEnded) window.__onJennaAndroidAudioEnded();", null)
        }
    }

    private fun addWavHeader(pcmBytes: ByteArray, sampleRate: Int, channels: Int): ByteArray {
        val totalDataLen = pcmBytes.size
        val totalFileLen = totalDataLen + 36
        val byteRate = sampleRate * channels * 2
        val blockAlign = channels * 2

        val header = ByteArray(44)
        header[0] = 'R'.code.toByte()
        header[1] = 'I'.code.toByte()
        header[2] = 'F'.code.toByte()
        header[3] = 'F'.code.toByte()
        header[4] = (totalFileLen and 0xff).toByte()
        header[5] = (totalFileLen shr 8 and 0xff).toByte()
        header[6] = (totalFileLen shr 16 and 0xff).toByte()
        header[7] = (totalFileLen shr 24 and 0xff).toByte()
        header[8] = 'W'.code.toByte()
        header[9] = 'A'.code.toByte()
        header[10] = 'V'.code.toByte()
        header[11] = 'E'.code.toByte()
        header[12] = 'f'.code.toByte()
        header[13] = 'm'.code.toByte()
        header[14] = 't'.code.toByte()
        header[15] = ' '.code.toByte()
        header[16] = 16 // 16 bytes for PCM fmt chunk
        header[17] = 0
        header[18] = 0
        header[19] = 0
        header[20] = 1 // Format 1 = PCM
        header[21] = 0
        header[22] = channels.toByte()
        header[23] = 0
        header[24] = (sampleRate and 0xff).toByte()
        header[25] = (sampleRate shr 8 and 0xff).toByte()
        header[26] = (sampleRate shr 16 and 0xff).toByte()
        header[27] = (sampleRate shr 24 and 0xff).toByte()
        header[28] = (byteRate and 0xff).toByte()
        header[29] = (byteRate shr 8 and 0xff).toByte()
        header[30] = (byteRate shr 16 and 0xff).toByte()
        header[31] = (byteRate shr 24 and 0xff).toByte()
        header[32] = blockAlign.toByte()
        header[33] = 0
        header[34] = 16 // 16 bits per sample
        header[35] = 0
        header[36] = 'd'.code.toByte()
        header[37] = 'a'.code.toByte()
        header[38] = 't'.code.toByte()
        header[39] = 'a'.code.toByte()
        header[40] = (totalDataLen and 0xff).toByte()
        header[41] = (totalDataLen shr 8 and 0xff).toByte()
        header[42] = (totalDataLen shr 16 and 0xff).toByte()
        header[43] = (totalDataLen shr 24 and 0xff).toByte()

        val fullWav = ByteArray(header.size + pcmBytes.size)
        System.arraycopy(header, 0, fullWav, 0, header.size)
        System.arraycopy(pcmBytes, 0, fullWav, header.size, pcmBytes.size)
        return fullWav
    }
}
