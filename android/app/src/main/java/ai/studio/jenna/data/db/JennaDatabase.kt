package ai.studio.jenna.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        ConversationEntity::class,
        MessageEntity::class,
        MemoryEntity::class,
        SettingsEntity::class
    ],
    version = 1,
    exportSchema = false
)
abstract class JennaDatabase : RoomDatabase() {
    abstract fun dao(): JennaDao

    companion object {
        @Volatile
        private var INSTANCE: JennaDatabase? = null

        fun getInstance(context: Context): JennaDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    JennaDatabase::class.java,
                    "jenna_database.db"
                ).fallbackToDestructiveMigration().build()
                INSTANCE = instance
                instance
            }
        }
    }
}
