package richmenu

import (
	"fmt"
	"io"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getImageCmd = &cobra.Command{
	Use:   "get-image",
	Short: "Download a rich menu image",
	RunE: func(cmd *cobra.Command, args []string) error {
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")
		outPath, _ := cmd.Flags().GetString("output")
		if richMenuID == "" {
			return &config.ClientError{Msg: "--rich-menu-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		blob, err := client.NewMessagingBlobAPI()
		if err != nil {
			return err
		}
		resp, err := blob.GetRichMenuImage(richMenuID)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		defer resp.Body.Close()

		if outPath != "" {
			f, err := os.Create(outPath)
			if err != nil {
				return fmt.Errorf("creating output file: %w", err)
			}
			defer f.Close()
			n, err := io.Copy(f, resp.Body)
			if err != nil {
				return fmt.Errorf("writing image: %w", err)
			}
			p.Success("Rich menu image saved", map[string]string{
				"file":  outPath,
				"bytes": fmt.Sprintf("%d", n),
			})
			return nil
		}
		if _, err := io.Copy(os.Stdout, resp.Body); err != nil {
			return fmt.Errorf("writing image to stdout: %w", err)
		}
		return nil
	},
}

func init() {
	getImageCmd.Flags().String("rich-menu-id", "", "rich menu ID (required)")
	getImageCmd.Flags().String("output", "", "save to file path (default: stdout)")
	_ = getImageCmd.MarkFlagRequired("rich-menu-id")
	RichMenuCmd.AddCommand(getImageCmd)
}
