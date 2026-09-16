-- image/catalog jaisa hi — longtext, na ki text (MySQL text 64KB tak hi
-- hoti hai, base64 audio usse bada ho sakta hai).
ALTER TABLE delegation_tasks ADD COLUMN voice_note longtext;
ALTER TABLE delegation_tasks ADD COLUMN voice_note_mime varchar(50) DEFAULT NULL;
