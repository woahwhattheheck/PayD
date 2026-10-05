-- Add timezone column to schedules table
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'UTC' NOT NULL;
