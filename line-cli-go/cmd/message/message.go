package message

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var MessageCmd = &cobra.Command{
	Use:   "message",
	Short: "Send messages via LINE Messaging API",
}

func init() {
	MessageCmd.AddCommand(pushCmd)
	MessageCmd.AddCommand(replyCmd)
	MessageCmd.AddCommand(multicastCmd)
	MessageCmd.AddCommand(broadcastCmd)
	MessageCmd.AddCommand(narrowcastCmd)
}

// buildMessages constructs a []messaging_api.MessageInterface from --text or --payload-file.
func buildMessages(text, payloadFile string) ([]messaging_api.MessageInterface, error) {
	if payloadFile != "" {
		data, err := os.ReadFile(payloadFile)
		if err != nil {
			return nil, fmt.Errorf("reading payload file: %w", err)
		}

		// Try parsing as a JSON array of messages first.
		var rawMsgs []json.RawMessage
		if err := json.Unmarshal(data, &rawMsgs); err == nil {
			msgs := make([]messaging_api.MessageInterface, 0, len(rawMsgs))
			for _, raw := range rawMsgs {
				msg, err := messaging_api.UnmarshalMessage(raw)
				if err != nil {
					return nil, fmt.Errorf("parsing message in array: %w", err)
				}
				msgs = append(msgs, msg)
			}
			return msgs, nil
		}

		// Fall back to a single message object.
		msg, err := messaging_api.UnmarshalMessage(data)
		if err != nil {
			return nil, fmt.Errorf("parsing payload JSON: %w", err)
		}
		return []messaging_api.MessageInterface{msg}, nil
	}
	if text == "" {
		return nil, fmt.Errorf("either --text or --payload-file is required")
	}
	return []messaging_api.MessageInterface{
		&messaging_api.TextMessage{
			Text: text,
		},
	}, nil
}
