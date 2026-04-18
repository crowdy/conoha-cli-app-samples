package message

import (
	"fmt"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var replyCmd = &cobra.Command{
	Use:   "reply",
	Short: "Reply to a message using a reply token",
	RunE: func(cmd *cobra.Command, args []string) error {
		replyToken, _ := cmd.Flags().GetString("reply-token")
		text, _ := cmd.Flags().GetString("text")
		payloadFile, _ := cmd.Flags().GetString("payload-file")

		if replyToken == "" {
			return fmt.Errorf("--reply-token is required")
		}
		p := output.NewPrinter(config.JSONMode(), nil)

		msgs, err := buildMessages(text, payloadFile)
		if err != nil {
			return err
		}

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		resp, err := api.ReplyMessage(
			&messaging_api.ReplyMessageRequest{
				ReplyToken: replyToken,
				Messages:   msgs,
			},
		)
		if err != nil {
			p.Error(0, err.Error())
			return err
		}

		sentIDs := make([]string, 0)
		if resp != nil {
			for _, m := range resp.SentMessages {
				sentIDs = append(sentIDs, m.Id)
			}
		}
		p.Raw(map[string]any{
			"sentMessages": sentIDs,
		})
		return nil
	},
}

func init() {
	replyCmd.Flags().String("reply-token", "", "reply token (required)")
	replyCmd.Flags().String("text", "", "text message content")
	replyCmd.Flags().String("payload-file", "", "JSON file with message payload")
}
