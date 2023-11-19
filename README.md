
## Birthdays API

API for Birthdays.run

Uses Cloudflare Workers, Cloudflare Durable Objects, Cloudflare Queues. Uses identity-bearerauth to check for a vaild session.  
  
Runs every three hours. Checks if a users saved birthdays are within a three hour window, today, tomorrow, in 1 week, in 2 weeks. If so, sends the birthday file to the emailer queue.
  
Creates a Cloudflare Durable Object per user, with fast, consistent storage.  
