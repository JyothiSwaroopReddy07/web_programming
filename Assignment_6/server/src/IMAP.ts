// Library imports.
import { ParsedMail } from "mailparser";
const ImapClient = require("emailjs-imap-client");
import { simpleParser } from "mailparser";

// App imports.
import { IServerInfo } from "./ServerInfo";

// Define interface to describe a mailbox and optionally a specific message to be supplied to various methods here.
export interface ICallOptions {
  mailbox: string,
  id?: number
}

// Define interface to describe a received message. Note that body is optional since it isn't sent when listing messages.
export interface IMessage {
  id: string,
  date: string,
  from: string,
  subject: string,
  body?: string,
  isSpam?: boolean
}

// Define interface to describe a mailbox.
export interface IMailbox {
  name: string,
  path: string
}

// Disable certificate validation (less secure, but needed for some servers).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// The worker that will perform IMAP operations.
export class Worker {

  // Server information.
  private static serverInfo: IServerInfo;

  /**
   * Constructor.
   */
  constructor(inServerInfo: IServerInfo) {
    console.log("IMAP.Worker.constructor", inServerInfo);
    Worker.serverInfo = inServerInfo;
  }

  /**
   * Connect to the SMTP server and return a client object for operations to use.
   *
   * @return An ImapClient instance.
   */
  private async connectToServer(): Promise<any> {
    const client: any = new ImapClient.default(
      Worker.serverInfo.imap.host,
      Worker.serverInfo.imap.port,
      { auth: Worker.serverInfo.imap.auth }
    );
    client.logLevel = client.LOG_LEVEL_NONE;
    client.onerror = (inError: Error) => {
      console.log("IMAP.Worker.connectToServer(): Connection error", inError);
    };
    await client.connect();
    console.log("IMAP.Worker.connectToServer(): Connected");
    return client;
  }

  /**
   * Returns a list of all (top-level) mailboxes.
   *
   * @return An array of objects, one per mailbox, that describes the mailbox.
   */
  public async listMailboxes(): Promise<IMailbox[]> {
    console.log("IMAP.Worker.listMailboxes()");
    const client: any = await this.connectToServer();
    const mailboxes: any = await client.listMailboxes();
    await client.close();

    const finalMailboxes: IMailbox[] = [];
    const iterateChildren: Function = (inArray: any[]): void => {
      inArray.forEach((inValue: any) => {
        finalMailboxes.push({
          name: inValue.name,
          path: inValue.path
        });
        iterateChildren(inValue.children);
      });
    };
    iterateChildren(mailboxes.children);
    return finalMailboxes;
  }

  /**
   * Lists basic information about messages in a named mailbox.
   *
   * @param inCallOptions An object implementing the ICallOptions interface.
   * @return              An array of objects, one per message.
   */
  public async listMessages(inCallOptions: ICallOptions): Promise<IMessage[]> {
    console.log("IMAP.Worker.listMessages()", inCallOptions);
    const client: any = await this.connectToServer();
    const mailbox: any = await client.selectMailbox(inCallOptions.mailbox);

    if (mailbox.exists === 0) {
      await client.close();
      return [];
    }

    const messages: any[] = await client.listMessages(
      inCallOptions.mailbox,
      "1:*",
      ["uid", "envelope"]
    );

    await client.close();

    const finalMessages: IMessage[] = [];
    messages.forEach((inValue: any) => {
      finalMessages.push({
        id: inValue.uid,
        date: inValue.envelope.date,
        from: inValue.envelope.from[0].address,
        subject: inValue.envelope.subject
      });
    });

    return finalMessages;
  }

  /**
   * Checks if a message contains spam based on keywords.
   *
   * @param body The plain text body of the email.
   * @return A boolean indicating whether the message is spam.
   */
  private checkForSpam(body: string): boolean {
    console.log("IMAP.Worker.checkForSpam()");
    const spamKeywords = ["lottery", "prize", "win", "free", "urgent", "offer"];
    const threshold = 2;

    const lowerCaseBody = body.toLowerCase();
    let spamScore = 0;
    spamKeywords.forEach((keyword) => {
      const regex = new RegExp(`\\b${keyword}\\b`, "g");
      spamScore += (lowerCaseBody.match(regex) || []).length;
    });

    return spamScore >= threshold;
  }

  /**
   * Gets the plain text body of a single message and checks for spam.
   *
   * @param  inCallOptions An object implementing the ICallOptions interface.
   * @return               The plain text body of the message and spam status.
   */
  public async getMessageBody(inCallOptions: ICallOptions): Promise<{ body?: string, isSpam: boolean }> {
    console.log("IMAP.Worker.getMessageBody()", inCallOptions);
    const client: any = await this.connectToServer();

    const messages: any[] = await client.listMessages(
      inCallOptions.mailbox,
      inCallOptions.id,
      ["body[]"],
      { byUid: true }
    );

    const parsed: ParsedMail = await simpleParser(messages[0]["body[]"]);
    await client.close();

    const isSpam = parsed.text ? this.checkForSpam(parsed.text) : false;

    return { body: parsed.text, isSpam };
  }

  /**
   * Deletes a single message.
   *
   * @param inCallOptions An object implementing the ICallOptions interface.
   */
  public async deleteMessage(inCallOptions: ICallOptions): Promise<any> {
    console.log("IMAP.Worker.deleteMessage()", inCallOptions);
    const client: any = await this.connectToServer();
    await client.deleteMessages(
      inCallOptions.mailbox,
      inCallOptions.id,
      { byUid: true }
    );
    await client.close();
  }

} /* End class. */
