BAck Up and Restore Database
pg_dump "postgresql://neondb_owner:npg_rIK2eQlyi3gf@ep-aged-river-ayqvr5pd.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require" -Fc -f "D:\neon-backup.dump"

pg_restore "D:\neon-backup.dump" -d "postgresql://neondb_owner:npg_42xTRKHLMQDO@ep-long-dawn-b4n3kct8-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require" --no-owner --no-acl


C:\Program Files\PostgreSQL\18\bin>
