package ai.studio.jenna.data.repository

import ai.studio.jenna.data.db.ConversationEntity
import ai.studio.jenna.data.db.JennaDatabase
import ai.studio.jenna.data.db.MemoryEntity
import ai.studio.jenna.data.db.MessageEntity
import ai.studio.jenna.data.db.SettingsEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class JennaDataRepository(private val database: JennaDatabase) {
    private val dao = database.dao()

    // ----------------------------------------------------
    // Conversations
    // ----------------------------------------------------
    suspend fun getConversationsJson(): String = withContext(Dispatchers.IO) {
        val list = dao.getAllConversations()
        val jsonArray = JSONArray()
        for (item in list) {
            if (item.rawJson.isNotEmpty()) {
                jsonArray.put(JSONObject(item.rawJson))
            } else {
                val obj = JSONObject().apply {
                    put("id", item.id)
                    put("title", item.title)
                    put("createdAt", item.createdAt)
                    put("updatedAt", item.updatedAt)
                    put("isPinned", item.isPinned)
                    put("messageCount", item.messageCount)
                    put("previewText", item.previewText)
                }
                jsonArray.put(obj)
            }
        }
        jsonArray.toString()
    }

    suspend fun saveConversationJson(json: String) = withContext(Dispatchers.IO) {
        val obj = JSONObject(json)
        val id = obj.getString("id")
        val title = obj.optString("title", "New Conversation")
        val createdAt = obj.optLong("createdAt", System.currentTimeMillis())
        val updatedAt = obj.optLong("updatedAt", System.currentTimeMillis())
        val isPinned = obj.optBoolean("isPinned", false)
        val messageCount = obj.optInt("messageCount", 0)
        val previewText = obj.optString("previewText", "")

        val entity = ConversationEntity(
            id = id,
            title = title,
            createdAt = createdAt,
            updatedAt = updatedAt,
            isPinned = isPinned,
            messageCount = messageCount,
            previewText = previewText,
            rawJson = json
        )
        dao.insertOrUpdateConversation(entity)
    }

    suspend fun deleteConversation(id: String) = withContext(Dispatchers.IO) {
        dao.deleteConversation(id)
        dao.deleteMessagesForConversation(id)
    }

    // ----------------------------------------------------
    // Messages
    // ----------------------------------------------------
    suspend fun getMessagesJson(conversationId: String): String = withContext(Dispatchers.IO) {
        val list = dao.getMessagesForConversation(conversationId)
        val jsonArray = JSONArray()
        for (item in list) {
            if (item.rawJson.isNotEmpty()) {
                jsonArray.put(JSONObject(item.rawJson))
            } else {
                val obj = JSONObject().apply {
                    put("id", item.id)
                    put("conversationId", item.conversationId)
                    put("role", item.role)
                    put("content", item.content)
                    put("timestamp", item.timestamp)
                    put("status", item.status)
                    if (item.modelUsed != null) put("modelUsed", item.modelUsed)
                }
                jsonArray.put(obj)
            }
        }
        jsonArray.toString()
    }

    suspend fun saveMessagesJson(conversationId: String, json: String) = withContext(Dispatchers.IO) {
        val jsonArray = JSONArray(json)
        val entities = mutableListOf<MessageEntity>()
        for (i in 0 until jsonArray.length()) {
            val obj = jsonArray.getJSONObject(i)
            entities.add(
                MessageEntity(
                    id = obj.getString("id"),
                    conversationId = conversationId,
                    role = obj.optString("role", "user"),
                    content = obj.optString("content", ""),
                    timestamp = obj.optLong("timestamp", System.currentTimeMillis()),
                    status = obj.optString("status", "complete"),
                    modelUsed = obj.optString("modelUsed", null),
                    rawJson = obj.toString()
                )
            )
        }
        dao.deleteMessagesForConversation(conversationId)
        if (entities.isNotEmpty()) {
            dao.insertMessages(entities)
        }
    }

    // ----------------------------------------------------
    // Long-Term Memories
    // ----------------------------------------------------
    suspend fun getMemoriesJson(): String = withContext(Dispatchers.IO) {
        val list = dao.getAllMemories()
        val jsonArray = JSONArray()
        for (item in list) {
            if (item.rawJson.isNotEmpty()) {
                jsonArray.put(JSONObject(item.rawJson))
            } else {
                val obj = JSONObject().apply {
                    put("id", item.id)
                    put("category", item.category)
                    put("content", item.content)
                    put("fact", item.content)
                    put("priority", item.priority)
                    put("isPinned", item.isPinned)
                    put("confidence", item.confidence)
                    put("enabled", item.enabled)
                    put("createdAt", item.createdAt)
                    put("updatedAt", item.updatedAt)
                    if (item.sourceConversationId != null) {
                        put("sourceConversationId", item.sourceConversationId)
                    }
                }
                jsonArray.put(obj)
            }
        }
        jsonArray.toString()
    }

    suspend fun saveMemoryJson(json: String) = withContext(Dispatchers.IO) {
        val obj = JSONObject(json)
        val id = obj.getString("id")
        val content = obj.optString("content", obj.optString("fact", ""))
        val priority = obj.optString("priority", if (obj.optBoolean("isPinned", false)) "high" else "medium")
        val isPinned = priority == "high" || obj.optBoolean("isPinned", false)

        val entity = MemoryEntity(
            id = id,
            category = obj.optString("category", "preferences"),
            content = content,
            priority = priority,
            isPinned = isPinned,
            confidence = obj.optDouble("confidence", 1.0),
            sourceConversationId = obj.optString("sourceConversationId", null),
            enabled = obj.optBoolean("enabled", true),
            createdAt = obj.optLong("createdAt", System.currentTimeMillis()),
            updatedAt = obj.optLong("updatedAt", System.currentTimeMillis()),
            rawJson = json
        )
        dao.insertOrUpdateMemory(entity)
    }

    suspend fun deleteMemory(id: String) = withContext(Dispatchers.IO) {
        dao.deleteMemory(id)
    }

    suspend fun clearAllMemories() = withContext(Dispatchers.IO) {
        dao.clearAllMemories()
    }

    // ----------------------------------------------------
    // Settings & User Identity
    // ----------------------------------------------------
    suspend fun getSettingsJson(): String? = withContext(Dispatchers.IO) {
        dao.getSettingValue("app_settings")
    }

    suspend fun saveSettingsJson(json: String) = withContext(Dispatchers.IO) {
        dao.saveSetting(SettingsEntity(key = "app_settings", valueJson = json))
    }

    suspend fun getUserIdentityJson(): String? = withContext(Dispatchers.IO) {
        dao.getSettingValue("user_identity")
    }

    suspend fun saveUserIdentityJson(json: String): String = withContext(Dispatchers.IO) {
        dao.saveSetting(SettingsEntity(key = "user_identity", valueJson = json))
        json
    }
}
