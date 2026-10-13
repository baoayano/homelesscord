import { FindOptionsWhere } from "typeorm";
import { OPCODES, Payload, WebSocket } from "@spacebar/gateway";
import { Session } from "@spacebar/database";
import { setHeartbeat } from "../util/Heartbeat";
import { Send } from "../util/Send";

interface QoSData {
    seq: number | null;
    qos: QoSPayload;
}

export interface QoSPayload {
    ver: number;
    active: boolean;
    reasons: string[];
}

const LastSeenInterval = 60_000;

export async function onHeartbeat(this: WebSocket, data: Payload) {
    // TODO: validate payload

    setHeartbeat(this);

    if (data.op === OPCODES.SetQoS) {
        this.qos = (data.d as QoSData).qos;
    }

    await Send(this, { op: 11, d: {} });
    const now = Date.now();
    if (this.session && now - (this.lastSeenWrite ?? 0) >= LastSeenInterval) {
        this.lastSeenWrite = now;
        Session.update({ session_id: this.session.session_id, user_id: this.user_id } as FindOptionsWhere<Session>, { last_seen: new Date() }).catch((e) =>
            console.error(`[Gateway/${this.user_id}] failed to record heartbeat`, e),
        );
    }
}
