# Getting verified

Global discovery has two levels of trust, and each one is checked by a different person.

1. **We approve instances.** The registry at `https://meowcord-registry.tiag.workers.dev` keeps the list of approved instances. Only an approved instance can federate, and only its servers show up under Other instances on everyone else's Discover page.
2. **Instance admins verify servers.** An approved instance publishes the servers its own admins verified. We don't review those servers one by one, so an instance's admins answer for what they verify.

We can remove or block any single server, user or whole instance at any time, whatever the instance's admins decided. See [emergency removals and blocks](#emergency-removals-and-blocks).

## Getting your instance approved

### What we check

We approve an instance when all of these hold:

- It runs on a real domain over HTTPS. Instances on localhost, an IP address or a private name never announce and can't be approved.
- It serves `/.well-known/meowcord` with federation on and its key, which a current Meowcord does by default.
- It runs a recent Meowcord. The registry shows the version each instance reports, and we ask for an update when it's far behind `main`.
- Registration asks for a captcha. Cap is on by default, see [captcha.md](../features/captcha.md).
- Someone moderates it and we can reach them. For a pull request that's the GitHub account that opened it. Otherwise put a contact in the instance description, which the instance serves in its well-known document.
- It follows the rules of the main project: it isn't built for spam, harassment or illegal content, and it doesn't reverse the owner policy in [CLAUDE.md](../../CLAUDE.md), such as putting features behind a payment or hiding pride flags.

### How to ask

You can do one of these or both.

- **Open a pull request.** Add your instance to `instances.json` at the repository root with `id`, `name`, `url` and `source_url`, run `bun scripts/instances-md.mjs` to regenerate `instances.md`, and open a pull request with both files. The admin dashboard's Federation page has the exact entry for your instance, with a Copy entry button and a link that opens the file for editing on GitHub. Once we merge it, the registry imports `instances.json` at minute 17 of the next hour and treats your instance as approved.
- **Let your instance announce itself.** A public instance with federation and `federation.announce` on announces itself on start, once a day and when an admin presses Send to registry on the Federation page. It shows up for review as pending, and nothing about it is published until we approve it in the registry's admin pages.

Your instance is `listed` once approved and `active` once the registry has read its key from `/.well-known/meowcord`. Only `active` instances federate. The Federation page shows the registry's view of your instance and the last error from the registry, if any.

### Keeping it approved

- **Keep `federation.key`.** It sits next to `jwt.key` in the working directory, or in the `state` volume under Docker. Back both up. When an approved instance starts serving a different key, the registry keeps publishing the old key, marks the instance "new key waiting" and ignores its discovery list until we confirm the change with you. Tell us in an issue when you rotate the key on purpose. This stops someone who takes over your domain from speaking for your instance.
- **Keep updating.** An old version can miss protocol changes and stop federating.
- **Answer reports.** We suspend an instance whose admins don't act on reports about it. A suspended instance stays in the document but other instances stop federating with it until we approve it again.

## Getting a server verified

This part happens on one instance, between the server owner and that instance's admins.

1. The owner opens Server Settings, Other instances, and turns on Show on other instances. The server gets a permanent invite if it has none, and people from other instances can join through that invite right away.
2. The server shows "waiting for this instance's admins" in that section.
3. An admin of the instance opens the admin dashboard, Federation, and presses Verify next to the server. The server goes into the instance's signed discovery list at `/.well-known/meowcord/discovery`.
4. 30 seconds after the last Verify or Take back, the instance announces itself to the registry, the registry fetches the new list and publishes a new document right away. Other instances show it under Other instances from their next registry fetch, which happens every 5 minutes. With `federation.announce` off, the registry only sees the change at its own rotating check, which reaches each instance every few hours, or when an admin presses Send to registry.

The owner sees "waiting for the registry" between steps 3 and 4 and "listed" after.

### What instance admins should check

Verifying a server puts your instance's name behind it. Before you press Verify, look at the server the way someone from another instance will see it:

- The name, icon and description match what the server is.
- The server has rules, and moderators who enforce them.
- AutoMod and raid protection are set up, or the server is small enough that its moderators keep up by hand.
- The content is fine to show anyone who opens Discover on any instance.

Press Take back to unverify a server. It leaves your discovery list right away, your instance announces 30 seconds later, and the registry publishes a document without it. Turning the switch off as the owner has the same effect.

By default an instance shows every server the registry lists. Set `federation.discovery.verification` to `instance` to also verify servers from other instances yourself before your users see them. The Federation page then lists them with the same Verify and Take back buttons.

## Emergency removals and blocks

These work no matter what the instance's admins decided.

| Who | What | Effect |
| --- | --- | --- |
| Us, in the registry | Remove a server from discovery | It leaves Other instances everywhere at the next publish. Joins through its invite still work. |
| Us, in the registry | Block a server or user | It leaves discovery, and every instance refuses its joins and federation. |
| Us, in the registry | Suspend an instance | It stops federating until we approve it again. |
| Us, in the registry | Block an instance | Every instance refuses its relays, joins and inbox requests, and hides its servers and users. |
| An instance's admins | Block an instance, server or user locally | Only that instance stops showing it and talking to it. |

The registry publishes a new signed document right after a block when an operator presses Sign and publish now, and at minute 17 of every hour otherwise. Instances fetch the document every 5 minutes. To report a server, user or instance, open an issue on GitHub with its link or canonical id, such as `@123@meow.example`.

See [registry.md](registry.md) for how the registry works and how we run it, and [federation.md](../features/federation.md) for everything else about federation.
