class MessageType {
    static get REQUEST_STORAGE_MANAGER() { return 0; }
}

class Message {
    #type;
    #data;

    constructor(type, data = null) {
        if(
            type !== MessageType.REQUEST_STORAGE_MANAGER
        )
            throw new Error("Parameter type has to be a number in the MessageType enum");

        this.#type = type;
        this.#data = data;
    }

    get type() {
        return this.#type;
    }

    get data() {
        return this.#data;
    }
}
