package ai.studio.jenna.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "conversations")
data class ConversationEntity(
    @PrimaryKey val id: String,
    val title: String,
    val createdAt: Long,
    val updatedAt: Long,
    val isPinned: Boolean = false,
    val messageCount: Int = 0,
    val previewText: String = "",
    val rawJson: String = ""
)

@Entity(tableName = "messages")
data class MessageEntity(
    @PrimaryKey val id: String,
    val conversationId: String,
    val role: String, // 'user' | 'assistant' | 'system'
    val content: String,
    val timestamp: Long,
    val status: String, // 'complete' | 'streaming' | 'error'
    val modelUsed: String? = null,
    val rawJson: String = ""
)

@Entity(tableName = "memories")
data class MemoryEntity(
    @PrimaryKey val id: String,
    val category: String,
    val content: String,
    val priority: String, // 'high' | 'medium' | 'low'
    val isPinned: Boolean = false,
    val confidence: Double = 1.0,
    val sourceConversationId: String? = null,
    val enabled: Boolean = true,
    val createdAt: Long,
    val updatedAt: Long,
    val rawJson: String = ""
)

@Entity(tableName = "settings")
data class SettingsEntity(
    @PrimaryKey val key: String,
    val valueJson: String,
    val updatedAt: Long = System.currentTimeMillis()
)
