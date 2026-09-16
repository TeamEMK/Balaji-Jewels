-- Delegation task banate waqt agar mic se bola gaya tha, uski asli voice
-- recording bhi save hoti hai (sirf transcribed text nahi) — taaki koi bhi
-- baad me sun sake ki asal me kya bola gaya tha.
ALTER TABLE delegation_tasks ADD COLUMN voice_note text;
ALTER TABLE delegation_tasks ADD COLUMN voice_note_mime varchar(50) DEFAULT NULL;
