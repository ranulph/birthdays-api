import * as z from "zod";
import { token } from "./token";

export interface Env {
	BIRTHDAYS_DO: DurableObjectNamespace;
	IDENTITY_BEARERAUTH: Fetcher;
	EMAILER_QUEUE: Queue<Birthday>;
};

const BirthdaySchema = z.object({
    id: z.string(),
		userId: z.string(),
    month: z.number(),
    day: z.number(),
    nextBirthday: z.number(),
    name: z.string().min(1, { message: "Must be at least 1 letter." }).max(10).trim(),
    lastName: z.string().optional(),
    onDay: z.boolean().default(true),
    dayBefore: z.boolean().default(false),
    oneWeekBefore: z.boolean().default(false),
    twoWeeksBefore: z.boolean().default(false)
});

type Birthday = z.infer<typeof BirthdaySchema>;

const corsHeaders = {
	'Access-Control-Allow-Headers': '*', 
	'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
	'Access-Control-Allow-Origin': 'https://birthdays.run', 
};

export class BIRTHDAYS_DO {

	state: DurableObjectState;
	env: Env

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
	}

	async fetch(request: Request, env: Env) {

		if (request.method === 'OPTIONS') {
			return new Response(JSON.stringify({ ok: true }), {
				headers: {
					...corsHeaders
				}
			});
		}

		if (request.method === 'GET') {
			const birthdays: Birthday[] = await this.state.storage?.get("birthdays") ?? [];
			let alarm = await this.state.storage?.getAlarm() ?? 0;
			const requestBody = { birthdays: birthdays, nextAlarm: alarm };
		
			return new Response(JSON.stringify(requestBody), {
				headers: {
					'Content-type': 'application/json',
					...corsHeaders
				  }
			});
		}

		if (request.method === 'POST') {

			const newBirthday: Birthday = await request.json();
	
			const result = BirthdaySchema.safeParse(newBirthday);
			if (!result.success) {
				return new Response(JSON.stringify({ ok: false, error: result.error }), {
					status: 400,
					headers: {
						'Content-type': 'application/json',
						...corsHeaders
					}
				});
			}

			let birthdays: Birthday[] = await this.state.storage?.get("birthdays") ?? [];
			if (birthdays.find(birthday => birthday.id === newBirthday.id)) {
				return new Response(JSON.stringify({ ok: false, error: "birthdayId already exists."}), {
					status: 400,
					headers: {
						'Content-type': 'application/json',
						...corsHeaders
					}
				});
			}

			birthdays.push(newBirthday)	
			birthdays.sort((a, b) => a.nextBirthday - b.nextBirthday);
			await this.state.storage?.put("birthdays", birthdays);
		
			return new Response(JSON.stringify({ ok: true }), {
				headers: {
					'Content-type': 'application/json',
					...corsHeaders
				}
			});
		}

		if (request.method === 'PUT') {
			const updateBirthday: Birthday = await request.json();

			const result = BirthdaySchema.safeParse(updateBirthday);
			if (!result.success) {
				return new Response(JSON.stringify({ ok: false, error: result.error }), {
					status: 400,
					headers: {
						'Content-type': 'application/json',
						...corsHeaders
					}
				});
			}

			let birthdays: Birthday[] = await this.state.storage?.get("birthdays") ?? [];
			if (birthdays.find(birthday => birthday.id === updateBirthday.id) === undefined) {
				return new Response(JSON.stringify({ ok: false, error: "birthdayId doesn't exist."}), {
					status: 400,
					headers: {
						'Content-type': 'application/json',
						...corsHeaders
					}
				});
			}
			birthdays.splice((birthdays.findIndex(birthday => birthday.id === updateBirthday.id)), 1, updateBirthday);
			birthdays.sort((a, b) => a.nextBirthday - b.nextBirthday);
			await this.state.storage?.put("birthdays", birthdays);
		
			return new Response(JSON.stringify({ ok: true }), {
				headers: {
					'Content-type': 'application/json',
					...corsHeaders
				}
			});
		}

		if (request.method === 'DELETE') {
			const requestBody: { birthdayId: string } = await request.json();
			const birthdayId = requestBody.birthdayId;

			if (!requestBody.birthdayId) {
				return new Response(JSON.stringify({ ok: false, error: "birthdayId not supplied." }), {
					status: 400,
					headers: {
						'Content-type': 'application/json',
						...corsHeaders
					}
				});
			}

			const result = z.string().safeParse(birthdayId);
			if (!result.success) {
				return new Response(JSON.stringify({ ok: false, error: result.error }), {
					status: 400,
					headers: {
						'Content-type': 'application/json',
						...corsHeaders
					}
				});
			}

			let birthdays: Birthday[] = await this.state.storage?.get("birthdays") ?? [];

			if (birthdays.findIndex(birthday => birthday.id === birthdayId) === -1) {
				return new Response(JSON.stringify({ ok: false, error: "birthdayId not found." }), {
					status: 404,
					headers: {
						'Content-type': 'application/json',
						...corsHeaders
					}
				});
			}

			let newBirthdayList: Birthday[] = [];
			birthdays.forEach(birthday => {
				if (birthday.id === birthdayId) {
					return;
				}
				newBirthdayList.push(birthday);
			});
			
			newBirthdayList.sort((a, b) => a.nextBirthday - b.nextBirthday);
			await this.state.storage?.put("birthdays", newBirthdayList);
		
			return new Response(JSON.stringify({ ok: true }), {
				headers: {
					'Content-type': 'application/json',
					...corsHeaders
				}
			});
		}
	}

	async alarm(env: Env) {

		let birthdays: Birthday[] = await this.state.storage?.get("birthdays") ?? [];
		let updatedBirthdays = birthdays;

		let currentTUnix = Date.parse(new Date().toString());
		birthdays.forEach(async (birthday) => {
			if (birthday.nextBirthday < currentTUnix) {
				let b = new Date(birthday.nextBirthday)
				b.setFullYear(b.getFullYear() + 1);
				birthday.nextBirthday = Date.parse(b.toString());
				updatedBirthdays.splice((updatedBirthdays.findIndex(birthdayItem => birthdayItem.id === birthday.id)), 1, birthday);
			} else {

				if (birthday.nextBirthday > currentTUnix && birthday.nextBirthday < (currentTUnix + 10800000) && birthday.onDay) await this.env.EMAILER_QUEUE.send(birthday);
				if (birthday.nextBirthday > (currentTUnix + 86400000) && birthday.nextBirthday < (currentTUnix + 97200000) && birthday.dayBefore) await this.env.EMAILER_QUEUE.send(birthday);
				if (birthday.nextBirthday > (currentTUnix + 604800000) && birthday.nextBirthday < (currentTUnix + 615600000) && birthday.oneWeekBefore) await this.env.EMAILER_QUEUE.send(birthday);
				if (birthday.nextBirthday > (currentTUnix + 1209600000) && birthday.nextBirthday < (currentTUnix + 1220400000) && birthday.twoWeeksBefore) await this.env.EMAILER_QUEUE.send(birthday);
			}
		})
		updatedBirthdays.sort((a, b) => a.nextBirthday - b.nextBirthday);
		await this.state.storage?.put("birthdays", updatedBirthdays);

		this.state.storage.setAlarm(Date.now() + 10800000);
	}
}

export default {

	async fetch(request: Request, env: Env, ctx: ExecutionContext) {

		if (request.method === 'OPTIONS') {
			return new Response(JSON.stringify({ ok: true }), {
				headers: {
					...corsHeaders
				}
			});
		}

		const authResponse = await env.IDENTITY_BEARERAUTH.fetch(request.clone())

		if (authResponse.status === 200) {
			const userId = authResponse.headers.get('userId')
			if (!userId) {
				return new Response(JSON.stringify({ error: 'Unknown User' }), {
					status: 404,
					...corsHeaders
				});
			}
			const id = env.BIRTHDAYS_DO.idFromName(userId);
			const stub = env.BIRTHDAYS_DO.get(id);
			
			const response = await stub.fetch(request);
			
			return response;
		} 
		return authResponse;
	},

	async queue(batch: MessageBatch<Birthday>, env: Env): Promise<void> {

		await Promise.all(batch.messages.map(async (birthdayMessage) => {
			try {
				await fetch('https://emailer.birthdays.run/sendemail', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': 'Bearer ' + token,
					},
					body: JSON.stringify(birthdayMessage.body)
				})
			} catch (err) {
				console.log(err);
			}
		}))
	}
}
